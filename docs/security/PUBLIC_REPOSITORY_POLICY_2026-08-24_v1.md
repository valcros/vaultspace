# Public Repository Content Policy

VaultSpace is developed in a public repository. Public content is limited to product source, generic configuration contracts, synthetic test fixtures, and documentation that is safe to disclose.

## Allowed content

- Product and provider implementation code.
- Generic deployment guidance, configuration variable names, and placeholder examples.
- Synthetic fixtures that use non-routable addresses and names such as `example.test`.
- Public product, API, architecture, installation, and security documentation.

## Restricted content

Do not commit operational evidence or environment-specific information, including:

- Credentials, keys, tokens, signed URLs, certificates, passwords, or connection strings.
- Subscription, account, resource, host, registry, revision, image, network, or infrastructure identifiers.
- Customer, tenant, user, room, invitation, browser-session, or protected-organization identifiers.
- Internal handoffs, audit evidence, incident records, release evidence, deployment output, or recovery runbooks containing operational details.

Restricted material belongs in an approved access-controlled operational store. It must not be added to this repository, pull-request discussion, issue, release body, workflow log, or generated artifact.

## Enforcement

- The `security:public-repo` check rejects restricted paths and high-confidence operational patterns without printing matched content.
- Credential scanning and GitHub push protection are additional controls, not substitutes for classification review.
- Any exception must be narrowly documented, time-bound, and approved by a repository security owner before merge.
- A clean current tree does not remove historic publication. History, artifacts, releases, workflow logs, forks, and caches require their own closure process.
