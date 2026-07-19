# Per-Org Email Sender Setup

VaultSpace can send transactional email from a per-organization identity (e.g.
`Brightside Group <brightside@vaultspace.org>`) instead of the shared
`noreply@vaultspace.org`. This has a code part (done) and an ops part (per org).

## How it works

- `Organization.emailSenderAddress` and `Organization.emailSenderName` (both
  nullable) hold the per-org identity. When unset, sends fall back to the global
  `ACS_SENDER_ADDRESS`.
- The provider interface takes an optional `from` (address) and `fromName`
  (display) per message. `EmailNotificationService` passes the org's values.
- **ACS:** the message `senderAddress` is set to the org address. **The display
  name is configured in ACS on the sender username, not in the message** (this is
  an ACS constraint). So `emailSenderName` is used by the SMTP provider and for
  the admin UI; ACS derives the display from its sender-username `displayName`.

## Ops step (required per org before it delivers)

The per-org address must be provisioned as a **verified sender username** on the
ACS email domain, or ACS will reject the send. For `brightside@vaultspace.org`:

```bash
# Add the sender username (with its display name) to the verified domain.
az communication email domain sender-username create \
  --resource-group <rg> \
  --email-service-name acs-vaultspace-email \
  --domain-name vaultspace.org \
  --sender-username brightside \
  --username brightside \
  --display-name "Brightside Group"
```

Then set the org fields (admin UI: Organization branding; or API):

```
PATCH /api/organization/branding
{ "emailSenderName": "Brightside Group", "emailSenderAddress": "brightside@vaultspace.org" }
```

## Order of operations (important)

Provision the ACS sender username **first**, then set `emailSenderAddress`. If the
address is set before it is verified in ACS, sends from that org will fail.

## Verify

Send a test invite from the org and confirm the recipient sees the org identity
in the From header.

## Not yet wired

- Admin settings UI field for the sender (settable via the branding API today).
- The forgot-password and worker `EMAIL_SEND` paths still use the global sender;
  they can adopt the same org-sender resolver as a follow-up.
