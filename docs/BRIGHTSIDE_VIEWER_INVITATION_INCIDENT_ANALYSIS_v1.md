# Brightside Viewer Invitation Incident Analysis

**Date:** 2026-08-21
**Severity:** Critical
**Status:** Root cause confirmed. Production remediation requires an authorized administrator.

## Executive finding

The supplied invitation URL is a team-member invitation (`/auth/register?token=...`), not a room-access link. Its acceptance flow correctly creates an authenticated account and an active organization-level `VIEWER` membership, but it cannot grant access to a data room because the invitation record and invite request do not carry a room identifier.

The room list then correctly applies the project's room-scoped, default-deny authorization contract. An organization viewer with no direct room permission therefore receives an empty `/api/rooms` result and lands on the exact empty Data Rooms screen reported by the tester.

This is an invitation workflow contract defect. It is not a browser session, loading, display, or room-list query defect.

## Verified request path

1. An administrator uses `POST /api/users/invite`.
2. The route accepts only `email` and an organization `role`; it creates an `Invitation` and emails `/auth/register?token=<secret>`.
3. The registration route accepts the invitation and, in one transaction, creates the user and `UserOrganization` membership.
4. No invitation field identifies a room, and the transaction does not create a `Permission` record.
5. `RoomService.list()` calls `PermissionEngine.getViewableRoomIds()`.
6. For an active organization `VIEWER` without a direct room `VIEW` permission, the resulting set is empty. The room page displays its empty state.

The documented `POST /api/users/invite` request already specifies optional `roomIds`, but the deployed implementation does not accept, persist, validate, or use that field. The Users page also tells administrators that viewers can view "assigned rooms" while offering no room-assignment control.

## Why this was missed

The relevant automated registration test asserts that an invited viewer becomes a verified organization member and receives a session. It does not assert an assigned room permission or a non-empty room list after acceptance. Existing integration coverage separately asserts the security rule that an organization viewer with no room grant sees no rooms. Both test suites pass while the end-to-end invitation contract remains incomplete.

## Immediate containment and recovery

Do not weaken `PermissionEngine` or reinstate organization-wide room visibility. That would violate the established default-deny model and could expose other Brightside rooms to all viewers.

For every viewer already affected:

1. Identify the intended Brightside room and the accepted viewer account.
2. Create one active direct permission with `resourceType: ROOM`, `granteeType: USER`, `permissionLevel: VIEW`, the intended `roomId`, and the viewer's `userId`.
3. Have the viewer refresh or sign out and back in. A new session is not required for authorization, but a fresh room-list request is required.
4. Verify that the viewer sees only the intended room, can list its documents, and cannot discover any other room.

The existing authorized endpoint is `POST /api/rooms/{roomId}/permissions`. It requires an organization administrator. There is currently no exposed UI for assigning a normal viewer this permission, so recovery must use an approved administrative API operation or a controlled operations script. Do not use the supplied invitation token for recovery and do not change invitation state.

## Required permanent repair

### Data contract

Add a first-class, immutable-at-acceptance invitation-to-room assignment. The preferred form is a normalized `InvitationRoomAssignment` table rather than a serialized array so that each assigned room has referential integrity, can be validated inside the invited organization, and can be audited independently.

Required properties:

- Invitation ID and room ID are unique as a pair.
- Room assignment is optional for `ADMIN` invitations and required for `VIEWER` invitations created from the team-invite flow.
- Every assigned room is validated as belonging to the inviting organization before the email is sent.
- A viewer acceptance transaction creates a direct `ROOM` / `USER` / `VIEW` permission for each assignment, with `grantedByUserId` set to the inviter.
- Permission creation is idempotent. An active matching grant is retained or upgraded only according to an explicit product rule.
- The acceptance audit event records the number of granted rooms and opaque room IDs, never the invitation token.

### API and UI contract

Extend `POST /api/users/invite` to accept `roomIds: string[]` for a `VIEWER`. Validate that the array is non-empty, deduplicated, and contains only rooms in the administrator's organization. Add an active-room multi-select to the Invite User dialog and block submission until at least one room is selected for a viewer. Administrator invitations remain organization-wide and do not need room selections.

The invitation email and registration page should state the selected room count or room names only after a security review of metadata disclosure. The first safe user-facing confirmation after acceptance is: "Your account has access to 1 data room" and redirect to `/rooms`.

### Atomic acceptance behavior

The existing user creation, organization membership, invitation state update, and room permission creation must occur in the same transaction. If any assigned room has been deleted, archived by policy, or no longer belongs to the organization, acceptance must fail safely without consuming the invitation. The administrator should then issue a new invitation with current assignments.

## Required regression tests

1. **Viewer invitation with one room:** acceptance creates the user, the organization membership, one direct room `VIEW` permission, and an authenticated session. The subsequent room list contains exactly that room.
2. **Viewer invitation with multiple rooms:** acceptance lists exactly the selected active rooms and no unassigned room.
3. **Cross-organization room ID:** invitation creation returns 400 and creates neither invitation nor assignment.
4. **No viewer room selection:** invitation creation returns 400 and sends no email.
5. **Administrator invitation:** acceptance remains organization-wide and does not create room-scoped viewer permissions.
6. **Concurrent acceptance:** only one user, membership, invitation acceptance, and permission set exists.
7. **Legacy accepted viewer:** applying the remediation grant makes the intended room visible while another unassigned room remains invisible.

## Three required analyses

### Strawman

Grant every organization `VIEWER` access to every current and future room, either by changing `PermissionEngine` or by automatically creating grants for all rooms at registration.

This would make Brightside's current single-room case appear fixed quickly. It is rejected because it defeats room-scoped access, expands access when new rooms are created, makes revocation ambiguous, and reintroduces a model that the existing authorization design intentionally removed.

### Steelman

Persist explicit room assignments at invitation creation and transform them into direct room permissions during the same transaction that accepts the invitation. Pair this with a viewer-specific room selector in the existing Invite User dialog and use the established room-permission engine unchanged.

This is the smallest durable repair because it uses the existing authorization model, preserves default deny, gives administrators an explicit choice, supports multi-room assignments, and creates a testable record of what was promised to the invitee.

### Pre-mortem

Assume the repair failed in production. The likely failure modes and controls are:

| Failure mode                                                | Early warning                                      | Control                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A viewer is invited with no room selected                   | Invite form succeeds with empty selection          | Require at least one active room for a viewer in both UI and API validation.                                                                     |
| A room from another organization is assigned                | A submitted ID is accepted despite tenant mismatch | Validate each room under the inviting organization's RLS context, then enforce the same check in the database transaction.                       |
| Acceptance consumes an invite but creates incomplete access | Invitation is `ACCEPTED`, but no permission exists | Create all four records atomically and test rollback on each failed write.                                                                       |
| A repair broadens access to unrelated rooms                 | A viewer sees a second Brightside room in the list | Retain `PermissionEngine` default deny and test the negative multi-room case.                                                                    |
| Existing affected viewers remain stranded                   | Support reports continue after deployment          | Run an audited remediation report for accepted legacy viewer invitations, have an admin map each to intended rooms, then verify per-user access. |

## Rollout and rollback

1. Ship the schema migration and application patch together to a staging environment.
2. Run the seven regression tests above plus the existing room-scoped authorization integration suite.
3. Create a synthetic viewer invitation with one selected room and verify the complete register-to-room-list flow in a clean browser profile.
4. Deploy during a monitored window. Do not issue further Brightside viewer invitations until the smoke test passes.
5. Apply explicit recovery grants for already-accepted affected viewers.
6. If a viewer can see an unassigned room, disable the new invitation UI endpoint immediately and revert the application release. Do not remove granted permissions automatically, because that could revoke legitimate administrator-approved access. Revoke only confirmed erroneous grants through an audited admin action.

## References

- `src/app/api/users/invite/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/services/RoomService.ts`
- `src/lib/permissions/PermissionEngine.ts`
- `src/app/api/rooms/[roomId]/permissions/route.ts`
- `src/app/(admin)/users/page.tsx`
- `src/app/api/auth/register/route.test.ts`
- `tests/integration/authorization-room-scope.test.ts`
- `API_SPEC.md`, F044 Invite User
- `PERMISSION_MODEL.md`, organization viewer and room-scoped authorization
