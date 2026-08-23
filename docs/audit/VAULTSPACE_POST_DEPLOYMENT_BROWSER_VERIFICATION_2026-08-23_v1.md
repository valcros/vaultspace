# VaultSpace Post-Deployment Browser Verification v1

## Release and Scope

- Release commit: `ac8487e140b69b0cd0da3069ff103e71f77ecdbf`.
- Deployment workflow: `Deploy to Staging` run `32618579742`, completed
  successfully.
- Live web revision: `ca-vaultspace-web--0000325`, serving 100% of traffic.
- Public health: healthy, Azure deployment mode, with no degraded capabilities.
- Browser surface: the connected Chrome session.
- Test scope: a newly registered, Gmail-verified, isolated test organization
  named `Browser's Organization`.

Brightside was not accessed during this verification. Medau was not accessed.
No action was taken in any customer tenant.

## Passed Browser Checks

- Public login and registration pages rendered correctly.
- Registration sent a verification email to a dedicated Gmail plus-alias test
  address; the message arrived promptly and its verification link was
  successfully consumed.
- Verified-account sign-in reached the isolated organization's dashboard.
- The settings security page correctly reports MFA enrollment as temporarily
  unavailable, with no enrollment action rendered.
- A new test room was created and opened successfully.
- A folder created in that room persisted and was visible after revisiting the
  direct room URL.
- All room-management tabs rendered without application errors: access, share
  links, Q&A, checklist, and calendar.
- User administration rendered the expected active administrator.
- A test group was created and persisted in the group directory.
- Activity and messaging surfaces rendered without application errors.
- Password change succeeded and reported that other sessions were signed out.
- A fresh sign-in using the new password reached the dashboard.
- After logout, a direct test-room URL redirected to `/auth/login` and did not
  expose the room title.

## Confirmed Product Defect

The `/rooms` index displays its page header and search controls but renders no
room cards when the organization contains only newly created draft rooms. This
was reproduced after a full page load and after a fresh sign-in.

The behavior is explained by the current product implementation:

- `POST /api/rooms` creates every room with status `DRAFT`.
- The rooms index treats a non-empty result as a populated list, but only
  renders status `ACTIVE` and `ARCHIVED`; it omits `DRAFT` and `CLOSED`.
- The tested room-management UI does not expose a status-transition action.

As a result, a newly created room is available through its direct URL but is
not discoverable from the main rooms index. This is a release-quality defect
outside the MFA-containment change and was not changed during this controlled
verification.

## Test Artifacts Retained

The following isolated artifacts remain in the Browser Verifier organization
for traceability, in accordance with the no-deletion constraint:

- Browser Release Verification 2026-08-23 room.
- Release Verification Evidence folder.
- Browser Verification Group.

The non-deliverable `.test` registration record and the Gmail-backed test
account were also retained. No test credentials, verification tokens, or
recovery codes are recorded in this document.
