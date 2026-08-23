# VaultSpace Room Lifecycle Remediation Design v1

## Decision

Release the room lifecycle repair as a focused production change. Keep MFA
enrollment disabled and retain invitation delivery as a separate reliability
workstream. This keeps an independently confirmed room-discovery and access
control defect from being coupled to unresolved authentication and email
delivery investigations.

## Confirmed Defect

New rooms are created as `DRAFT`, but the rooms index only rendered `ACTIVE`
and `ARCHIVED` rooms. A newly created room was therefore usable through a
known direct URL but absent from the normal rooms index. The controlled browser
verification documented the reproduction in
`VAULTSPACE_POST_DEPLOYMENT_BROWSER_VERIFICATION_2026-08-23_v1.md`.

## Target Lifecycle Contract

| State      | Normal audience                                        | Administrator actions | Permitted next state |
| ---------- | ------------------------------------------------------ | --------------------- | -------------------- |
| `DRAFT`    | Organization and room administrators only              | Publish or close      | `ACTIVE`, `CLOSED`   |
| `ACTIVE`   | Authorized participants                                | Archive or close      | `ARCHIVED`, `CLOSED` |
| `ARCHIVED` | Organization and room administrators only              | Restore or close      | `ACTIVE`, `CLOSED`   |
| `CLOSED`   | Organization administrators only, for retained history | None                  | None                 |

The public-facing access boundary is `ACTIVE`. Non-active room lookup and
folder metadata lookup require room-administrator capability. Lifecycle
transitions are organization-administrator operations and must use the
central lifecycle service.

## Implementation

- Render separate Draft, Active, Archived, and administrative Closed sections
  on the rooms index.
- Provide explicit confirmation for publish and close actions. Closing retains
  records rather than deleting them.
- Define an allow-list transition table and reject impossible transitions.
- Route API status changes and closure through `RoomService.changeStatus`.
- Persist lifecycle timestamps and the immutable audit event in the same
  tenant-scoped transaction as the status update.
- Prevent non-administrators with legacy direct room access from retrieving
  draft, archived, or closed room and folder metadata.
- Add service, route authorization, folder authorization, and browser
  regression coverage.

## Independent Reviews

### Strawman Review

Recommended retaining the default `DRAFT` state, adding an administrator
publish action, centralizing status changes, and ensuring invitations do not
return false success when delivery fails. The implementation adopts the first
three recommendations. Invitation delivery remains deliberately out of scope
for this release.

### Steelman Review

Recommended an explicit state machine, organization-administrator authority
for publishing and closing, status timestamps, and avoiding direct route-level
status writes that bypass audit evidence. The implementation adopts each of
these recommendations.

### Pre-Mortem Review

Identified direct draft-room and folder endpoint exposure as the primary
failure mode, along with ambiguous deletion wording and missing browser
acceptance coverage. The implementation adds a non-active access gate, uses
close-and-retain wording, and adds the affected browser flow to regression
coverage.

## Deliberately Deferred Work

- **MFA:** enrollment remains disabled by the existing feature gate. The live
  login-failure investigation remains separate. Existing integration coverage
  demonstrates that the UUID database call executes, so it is not treated as a
  proven root cause.
- **Invitation delivery:** the current endpoint can persist an invitation even
  when delivery fails. A durable solution requires delivery state, provider
  acceptance recording, retry/repair behavior, and an isolated-inbox test. It
  will be planned and released separately.

## Verification Gate

Before merge: targeted unit and route tests, TypeScript, lint, formatting,
production build, and the room browser regression test must pass. After the
automatic deployment: verify the healthy revision, then use an isolated test
organization in the connected Chrome session to create a draft room, see it in
the index, publish it, reload, and confirm it appears as active. Brightside
and Medau are excluded from this verification.
