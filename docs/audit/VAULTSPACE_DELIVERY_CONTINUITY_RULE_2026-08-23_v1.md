# VaultSpace Delivery Continuity Rule

**Status:** Active process rule
**Established:** 2026-08-23
**Applies to:** VaultSpace implementation, remediation, release, and validation work

## Lesson learned

When authorized verification identifies an in-scope defect, a correct diagnosis or a partially implemented branch is not a delivery outcome. The work remains active until the agreed remediation has been implemented, independently reviewed, validated, released through the approved path, and retested in the deployed environment.

## Operating rule

1. On finding a defect, record the evidence, scope the smallest complete remediation, and continue the authorized delivery workflow.
2. Do not present a handoff, status report, or partial branch as a completion point while in-scope implementation, verification, review, release, or retest remains.
3. Treat an interim update as progress reporting only. State the remaining work and keep it active.
4. Before release, obtain the required technical review and run proportionate automated checks. For a security or lifecycle-control defect, server-side enforcement and direct-route tests are required; hiding a UI affordance alone is insufficient.
5. Complete the approved delivery path: pull request, CI, merge, deployment health verification, and isolated-tenant browser retest.
6. Report final completion only with durable evidence: commit and pull-request reference, CI result, deployed revision and health, and test results.

## Narrow exceptions

Pause only when one of the following is true:

- A required action needs authority the user has not granted, including a specifically required per-action confirmation.
- The work would materially expand beyond the approved scope or create a significant irreversible external effect.
- A reproducible external blocker prevents progress after safe alternatives have been exhausted.

In those cases, describe the exact blocker, preserve the completed work, and continue every safe in-scope task. This rule does not override tenant restrictions, credential safeguards, destructive-action safeguards, or explicitly required confirmations.

## Completion checklist

- [ ] Defect reproduced or evidenced in an authorized isolated environment.
- [ ] Server-side policy is centralized and all applicable mutation routes enforce it.
- [ ] UI represents the enforced state without offering misleading controls.
- [ ] Focused tests and full required quality checks pass.
- [ ] Independent review feedback is addressed and recorded.
- [ ] Pull request is merged and the deployment is healthy.
- [ ] Browser verification on an authorized isolated tenant confirms the deployed behavior.

## Application to the current incident

The closed-room workspace exposed write affordances after a room had been closed. This rule requires completing the server-side immutability remediation, its tests and review, release, and deployed browser validation rather than stopping after the first observed failure or a partial hotfix.
