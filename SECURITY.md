# Security Policy - VaultSpace

**Project:** VaultSpace
**Scope:** Open-source secure document collaboration platform (AGPLv3)
**Status:** Active
**Last Updated:** 2026-03-14

---

## Table of Contents

1. [Supported Versions](#supported-versions)
2. [Reporting a Vulnerability](#reporting-a-vulnerability)
3. [Security Architecture Summary](#security-architecture-summary)
4. [Security Best Practices for Self-Hosting](#security-best-practices-for-self-hosting)
5. [Dependency Management](#dependency-management)
6. [Security-Related Configuration](#security-related-configuration)
7. [Compliance](#compliance)
8. [Bug Bounty Program](#bug-bounty-program)

---

## Supported Versions

| Version | Supported | Security Updates | End of Life |
| ------- | --------- | ---------------- | ----------- |
| 1.x     | ✅ Yes    | Until 2028-03-14 | 2028-03-14  |
| 0.x     | ❌ No     | Not supported    | 2025-12-31  |

**Security Update Cadence:** Critical security patches are released within 7 days of discovery. Regular dependency updates are released monthly.

---

## Reporting a Vulnerability

We take security seriously and appreciate responsible disclosure. If you discover a security vulnerability in VaultSpace, please follow this process:

### Responsible Disclosure Process

1. **Do NOT open a public GitHub issue** for security vulnerabilities.

2. **Email the security team:**
   - **Email:** security@vaultspace.org
   - **Subject Line:** `[SECURITY] [CRITICAL/HIGH/MEDIUM] Brief vulnerability description`
   - **Include:**
     - Detailed description of the vulnerability
     - Affected version(s)
     - Proof of concept or steps to reproduce
     - Suggested remediation (if available)
     - Your contact information (name, email, GPG key if available)

3. **Expected Response Timeline:**
   - **48 hours:** Initial acknowledgment of receipt
   - **7 days:** Initial assessment and triage
   - **30 days:** Security patch release (for critical vulnerabilities; may vary for lower severity)
   - **90 days:** Coordinated public disclosure (unless circumstances require different timing)

4. **PGP Key:**
   - **Key ID:** `PLACEHOLDER-KEYID`
   - **Fingerprint:** `PLACEHOLDER-FINGERPRINT`
   - **Available:** Contact security@vaultspace.org to request the public key

### Vulnerability Disclosure

Once a security patch is released:

- A CVE will be requested if applicable
- A security advisory will be published on GitHub
- Vulnerability will be added to the National Vulnerability Database (NVD)
- All affected users will be notified via email and security mailing list

### Credit

We will publicly credit security researchers who report vulnerabilities responsibly (unless you prefer to remain anonymous).

---

## Security Architecture Summary

VaultSpace is built with security as a foundational principle. The following summarizes key security mechanisms. For detailed architecture, refer to [ARCHITECTURE.md](./ARCHITECTURE.md) and [PERMISSION_MODEL.md](./PERMISSION_MODEL.md).

### 14-Layer Permission Engine (Deny-by-Default)

Every access decision flows through a multi-layered permission engine with explicit deny-by-default semantics:

1. **Multi-Tenant Scoping** – Isolates organizations at query layer
2. **Organization Membership** – User must be member of target organization
3. **Organization Role** – Owner/Admin/Member roles define baseline capabilities
4. **Room-Level Membership** – User must be invited to the room
5. **Room-Level Role** – Admin/Viewer roles on the room
6. **Folder Inheritance** – Permissions cascade from folder to documents
7. **Document-Level Permissions** – Explicit per-document access grants
8. **Link-Level Permissions** – For anonymous shared links
9. **Time-Based Constraints** – Access expires at defined time
10. **IP-Based Constraints** – IP allowlist/blocklist enforcement
11. **NDA Requirements** – NDA acceptance gating (V1+)
12. **Password Protection** – Room password verification
13. **Legal Hold** – Document hold for litigation/compliance
14. **Resource State** – Archived rooms and soft-deleted documents deny access

**Key Principle:** No grant → No access. Explicit allow + Explicit deny → Deny wins.

### Immutable Audit Trail

- All user activity (uploads, views, downloads, permission changes) is recorded in an immutable event log
- Events are append-only; never modified after creation (soft-delete only)
- Includes: request ID, session ID, actor ID, IP address, user-agent, timestamp
- Partitioned by month for query performance at scale
- Default retention: 2 years; configurable per organization
- Archived to cold storage (S3 Glacier) after 1 year
- Enables compliance reporting, forensics, and detailed audit trails

### Document Integrity via SHA-256 Hash Chain

- Every document version has a SHA-256 hash computed at upload time
- Hash chain prevents undetected tampering or bit-flipping
- Hash is stored immutably alongside document metadata
- Optional: Document certification and signature support (V2+)

### Encryption at Rest (AES-256-GCM)

- **MVP:** Not included (F120). MVP relies on filesystem-level or cloud-provider encryption. Application-level AES-256-GCM is V1.
- **V1+:** Centralized key management via HashiCorp Vault, AWS KMS, or Azure Key Vault
- **V2+:** Automatic key rotation with re-encryption of existing documents
- All sensitive data at rest is encrypted before storage (V1+)
- Encryption keys are never stored in application logs or backups

### Virus Scanning (ClamAV Integration)

- Every uploaded document is scanned for malware before becoming viewable
- Infected documents are quarantined and marked as unsafe
- Admins are alerted immediately upon detection
- Scanning happens asynchronously; upload completes but viewing is blocked until scan result is available
- Supports custom scan providers via adapter pattern

### HTTPS Everywhere

- All client-server traffic is encrypted via TLS 1.2+
- TLS termination at reverse proxy (Nginx, Caddy, AWS Application Gateway)
- No unencrypted HTTP traffic allowed in production
- Strict Transport Security (HSTS) header enforced

### Private Storage with Signed URLs

- Document storage buckets are private (no public read access)
- Access to documents is exclusively via temporary signed URLs
- Preview URLs: 5-minute expiry (prevents casual sharing that bypasses permissions)
- Download URLs: 1-hour expiry (allows larger file downloads)
- Each signed URL request re-checks permissions at generation time
- Access revocation takes effect immediately on next URL refresh

### Server-Side Permission Checks

- **All API endpoints check permissions via PermissionEngine before serving data**
- No client-side permission checks (assume malicious client)
- Permission decisions are logged for audit purposes

### Rate Limiting

- Global rate limit: 100 requests/minute per IP
- Per-user rate limit: 1,000 requests/minute per authenticated user
- Password verification: 5 attempts per 5 minutes per IP/room
- Brute-force protection on login and password-protected rooms

---

## Security Best Practices for Self-Hosting

When deploying VaultSpace in your environment, follow these best practices to maintain a strong security posture:

### 1. Network Isolation

- **PostgreSQL & Redis:** Keep both private; never expose to the internet
- Use internal-only security groups or network policies
- Database should only be accessible from the app tier
- Redis should only be accessible from the app tier and workers
- Restrict SSH/admin access to bastion hosts

### 2. HTTPS Everywhere

- Deploy a reverse proxy (Nginx, Caddy, Azure Application Gateway) in front of the app
- Terminate TLS at the reverse proxy
- Use valid, trusted certificates (Let's Encrypt for self-signed/testing)
- Set `HTTPS=true` in environment; enforce HSTS headers
- Disable HTTP or redirect all HTTP traffic to HTTPS

### 3. Reverse Proxy Configuration

- Set proper X-Forwarded-\* headers (X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host)
- Configure CORS headers appropriately (restrict to your domain)
- Implement request size limits (e.g., max upload 100MB)
- Configure appropriate timeouts (e.g., upload timeout 10 minutes)

### 4. Enable Virus Scanning

- Deploy ClamAV or equivalent scanner
- Set `SCAN_PROVIDER=clamav` and configure scanner endpoint
- Monitor scanner logs for detection events
- Keep virus definition database updated daily
- Document quarantine policy (delete, archive, alert admin)

### 5. Regular Backups

- Perform automated database backups daily (or more frequently for critical systems)
- Store encrypted backups offsite (separate cloud account or geographic region)
- Test restore procedures regularly (at least quarterly)
- Backup both PostgreSQL data and document storage
- Retention: minimum 30 days; 90 days recommended
- Ensure backups are encrypted and access-controlled

### 6. Environment Variable Security

- **Never commit secrets** (keys, passwords, API tokens) to version control
- Use environment variable management tools (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault)
- Rotate secrets on a regular schedule (quarterly minimum)
- Never log environment variables or secrets in application output
- Restrict access to `.env` files and secret stores to authorized personnel only
- Use a secrets scanner in your CI/CD pipeline to prevent accidental commits

### 7. Encryption Key Rotation

- **V1+:** Implement automatic key rotation via Vault or cloud KMS
- Rotate encryption keys at least annually
- Document key rotation procedures and test them quarterly
- Maintain secure offline backup of master key (encrypted)
- Plan for key recovery scenarios (compromise, loss of key manager)

### 8. Access Control & Authentication

- Enable Two-Factor Authentication (2FA/TOTP) for all admin users
- Enforce strong password policies (minimum 12 characters, complexity requirements)
- Use organization-wide SSO (OIDC, SAML, LDAP) if available
- Implement IP allowlisting for admin interfaces
- Rotate service account credentials every 90 days

### 9. Audit Log Management

- Export audit logs regularly to a separate, immutable store
- Monitor logs for suspicious activity (multiple failed logins, unusual access patterns)
- Set up alerts for critical events (room creation, permission changes, quarantined documents)
- Ensure audit log retention meets your compliance requirements
- Test audit log query performance with large datasets

### 10. Monitoring & Alerting

- Monitor disk space, memory, and CPU utilization
- Alert on database connection failures or performance degradation
- Monitor for error rates and latency spikes in application logs
- Set up alerts for security-related events:
  - Multiple failed login attempts
  - Virus detection
  - Unauthorized access attempts (403 errors)
  - Permission changes
- Collect logs centrally (ELK, Splunk, CloudWatch, Azure Insights)

### 11. Regular Security Updates

- Subscribe to the VaultSpace security mailing list
- Apply critical security patches within 7 days of release
- Apply other updates as part of monthly maintenance windows
- Test updates in a staging environment before production deployment

### 12. Compliance & Legal Holds

- Configure audit log retention to meet regulatory requirements (SOC2, HIPAA, GDPR, etc.)
- Implement legal hold functionality for documents under litigation
- Document your data retention and deletion policies
- Perform regular compliance audits against your policies

---

## Dependency Management

VaultSpace manages external dependencies carefully to minimize supply chain risk.

### Automated Scanning

- Dependencies are scanned for known vulnerabilities using OWASP Dependency-Check
- CI/CD pipeline blocks builds if critical vulnerabilities are detected
- Scan results are available in GitHub security tab

### Regular Updates

- Dependencies are updated monthly (or more frequently if vulnerabilities are reported)
- All updates are tested in CI/CD before merge
- Backward compatibility is maintained when possible
- Major version upgrades are carefully planned and tested

### Approved Dependencies

Core dependencies are chosen for:

- Security track record and maintenance status
- Minimal external dependencies (reducing attack surface)
- Open-source licenses compatible with AGPLv3
- Active maintenance and responsive security patches

**Key Dependencies:**

- **Framework:** Next.js 14+, React 18+
- **Database:** Prisma 5+ (PostgreSQL)
- **Cache:** Redis/BullMQ
- **Storage:** Cloud storage adapters (AWS S3, Azure Blob, GCP Cloud Storage)
- **Scanning:** ClamAV
- **Encryption:** Node.js crypto module (built-in)

---

## Security-Related Configuration

The following environment variables control security features:

| Variable                     | Purpose                                                                 | Default                | Example                          |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------- | -------------------------------- |
| `ENCRYPTION_KEY`             | AES-256 encryption key (base64-encoded) – V1 only, not required for MVP | _N/A_                  | `(base64-256-bit-key)`           |
| `ENCRYPTION_PROVIDER`        | Key management provider (env, vault, kms, keyvault)                     | `env`                  | `vault`                          |
| `VAULT_ADDR`                 | HashiCorp Vault address                                                 | Not set                | `https://vault.example.com:8200` |
| `VAULT_TOKEN`                | Vault authentication token                                              | Not set                | `hvs.CAESIBz...`                 |
| `SCAN_PROVIDER`              | Virus scanner (clamav, mock)                                            | `mock`                 | `clamav`                         |
| `CLAMAV_ENDPOINT`            | ClamAV server endpoint                                                  | `tcp://localhost:3310` | `tcp://scanner.internal:3310`    |
| `HTTPS`                      | Enforce HTTPS                                                           | `true`                 | `true`                           |
| `HSTS_MAX_AGE`               | HSTS header max-age (seconds)                                           | `31536000`             | `31536000`                       |
| `RATE_LIMIT_WINDOW`          | Rate limit window (milliseconds)                                        | `60000`                | `60000`                          |
| `RATE_LIMIT_MAX_REQUESTS`    | Max requests per window per IP                                          | `100`                  | `100`                            |
| `SESSION_TIMEOUT_MINUTES`    | Idle session timeout                                                    | `60`                   | `60`                             |
| `PASSWORD_MIN_LENGTH`        | Minimum password length                                                 | `12`                   | `12`                             |
| `PASSWORD_REQUIRE_UPPERCASE` | Require uppercase letters                                               | `true`                 | `true`                           |
| `PASSWORD_REQUIRE_NUMBERS`   | Require numeric characters                                              | `true`                 | `true`                           |
| `PASSWORD_REQUIRE_SYMBOLS`   | Require special characters                                              | `true`                 | `true`                           |
| `AUDIT_LOG_RETENTION_DAYS`   | Audit log retention (days)                                              | `730`                  | `730`                            |
| `AUTH_PROVIDER`              | Authentication provider (builtin, oidc, ldap, saml)                     | `builtin`              | `oidc`                           |
| `OIDC_ISSUER_URL`            | OIDC provider issuer URL                                                | Not set                | `https://auth.example.com`       |
| `OIDC_CLIENT_ID`             | OIDC client ID                                                          | Not set                | `client-id`                      |
| `OIDC_CLIENT_SECRET`         | OIDC client secret                                                      | Not set                | `client-secret`                  |

**Security Notes:**

- Never commit `ENCRYPTION_KEY`, `VAULT_TOKEN`, or `OIDC_CLIENT_SECRET` to version control
- Store these values in a secure secret manager (HashiCorp Vault, AWS Secrets Manager, etc.)
- Rotate sensitive credentials quarterly
- Use strong, randomly generated values for all secrets

---

## Compliance

VaultSpace is designed to meet compliance requirements of regulated industries. Compliance features include:

### SOC2 Type II

- Immutable audit trail supports SOC2 Trust Service Criteria (CC6.1, CC7.2, CC7.4)
- Access controls and permission engine (CC6.2, CC9.2)
- Encryption at rest and in transit (CC6.1)
- Incident response and change management
- _Note: Full SOC2 attestation requires third-party audit; configuration choices affect scope_

### HIPAA (Healthcare)

- Encryption at rest (AES-256) and in transit (TLS 1.2+)
- Audit logging of all access (required for HIPAA)
- Access controls and role-based permission engine
- Secure deletion and purging of sensitive data
- _Note: HIPAA compliance requires Business Associate Agreement (BAA) with deployment provider_

### GDPR (Data Protection)

- Data subject access request (DSAR) support via audit trail queries
- Right to erasure (soft delete with legal hold support)
- Data processing agreements and documentation
- Encryption and access controls
- Incident notification and audit trails

### SOX (Financial Services)

- Immutable audit trail with no modify/delete (financial audit requirements)
- Change management and version control
- Access controls and segregation of duties
- Encryption and secure deletion

**Compliance Mapping:**
Refer to the VaultSpace Feature Matrix (F147) for detailed compliance mappings and required configurations per standard.

---

## Bug Bounty Program

VaultSpace values the security research community and is committed to responsible vulnerability disclosure.

### Bug Bounty Roadmap

- **Planned Q2 2026:** Initial bug bounty program launch
- **Initial scope:** Critical and High severity vulnerabilities only
- **Reward tier:** To be determined (based on severity and impact)
- **Duration:** Ongoing

### Participate

When the program launches, details will be posted on:

- Official VaultSpace website (vaultspace.org)
- GitHub Security tab
- Security mailing list (security-updates@vaultspace.org)

Researchers who report vulnerabilities responsibly prior to program launch should still follow the [Reporting a Vulnerability](#reporting-a-vulnerability) process above.

---

## Questions?

For security questions or concerns not covered in this policy:

- **Email:** security@vaultspace.org
- **Discussion:** Use GitHub Discussions with the `security` tag
- **Mailing List:** Subscribe to security-updates@vaultspace.org

---

## Version History

| Date       | Version | Changes                                    |
| ---------- | ------- | ------------------------------------------ |
| 2026-03-14 | 1.0     | Initial security policy for VaultSpace MVP |

---

**Document ID:** F147 – Security Policy
**Status:** Active
**Next Review:** 2026-09-14
