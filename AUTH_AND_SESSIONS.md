# AUTH_AND_SESSIONS.md - VaultSpace Authentication & Session Management

**Feature IDs:** F102, F141, F145, F154
**Priority:** MVP (Foundation)
**Status:** Specification
**Last Updated:** 2026-03-14

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication Flows](#authentication-flows)
3. [Password Security](#password-security)
4. [Session Management](#session-management)
5. [Token Specifications](#token-specifications)
6. [Session Invalidation Rules](#session-invalidation-rules)
7. [Multi-Tenant Session Context](#multi-tenant-session-context)
8. [Security Headers & CSRF](#security-headers--csrf)
9. [Prisma Models](#prisma-models)
10. [TypeScript Implementation Examples](#typescript-implementation-examples)
11. [API Endpoints](#api-endpoints)
12. [Middleware Architecture](#middleware-architecture)
13. [Security Test Matrix](#security-test-matrix)
14. [Cross-References](#cross-references)

---

## Overview

### Authentication Strategy (MVP)

VaultSpace MVP uses **email/password authentication only**. No SSO, OAuth, or social login in MVP.

**Key Decisions:**

- Password hashing: bcrypt with cost factor 12
- Minimum password entropy: 8 characters, max 128 (NIST 800-63B compliant, no composition rules)
- Breached password detection: k-anonymity API (Have I Been Pwned)
- Email provider: SMTP with console fallback in dev
- Rate limiting: Per-email login (5/min), per-IP (20/min)

### Session Management Strategy

**Not JWT.** Sessions stored in PostgreSQL with Redis caching for performance. Enables:

- Server-side session revocation (invalidate all sessions on password change)
- Audit trail of session activity
- Prevention of token reuse after invalidation
- Sliding-window idle timeout (24 hours idle, 7 days absolute max)

### Trust Boundary

- Session token is the **sole source of truth** for authentication
- Session contains cryptographically secure random 256-bit token (base64url)
- organizationId bound to session at login time (never from headers)
- All authorization checks flow through PermissionEngine after session validation

---

## Authentication Flows

### 1. Email/Password Login

**Endpoint:** `POST /api/auth/login`

**Request:**

```typescript
interface LoginRequest {
  email: string; // Required, must be valid email
  password: string; // Required, 8-128 chars
  organizationSlug?: string; // Optional; if omitted, redirect to org selector for multi-org users
}
```

**Response (Success):**

```typescript
interface LoginResponse {
  success: true;
  sessionToken: string; // 256-bit random, base64url
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    organizations: Array<{
      id: string;
      name: string;
      slug: string;
    }>;
  };
  currentOrganization: {
    id: string;
    name: string;
    slug: string;
  };
  expiresAt: number; // Unix timestamp (24 hours from now)
}
```

**Response (Error 401):**

```typescript
interface LoginErrorResponse {
  success: false;
  error: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'BREACHED_PASSWORD';
}
```

**Process:**

1. **Validate input:** Email format, password length
2. **Rate limit check:** 5 login attempts per email per minute
3. **Lookup user:** Find user by email (case-insensitive)
4. **Account check:** Verify user.isActive === true
5. **Password verify:** bcrypt.compare(password, user.passwordHash)
6. **Breached password check:** HIBP k-anonymity API (non-blocking; log if breached but allow login)
7. **Create session:** Generate 256-bit random token, store in database
8. **Return:** Session token + user data
9. **Set cookie:** HttpOnly, Secure, SameSite=Lax, path=/, domain-scoped
10. **Emit event:** USER_LOGIN (with IP, user-agent)

**Organization Selection Logic:**

- If user has one organization: auto-bind session to that org
- If user has multiple organizations and organizationSlug provided: bind to specified org
- If user has multiple organizations and no slug: return list of orgs, require user to call login again with slug

---

### 2. Registration/Signup

**Endpoint:** `POST /api/auth/register`

**Request:**

```typescript
interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationSlug?: string; // Optional; for self-signup flow
}
```

**Response (Success):**

```typescript
interface RegisterResponse {
  success: true;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  message: 'Verification email sent' | 'Auto-verified (self-signup disabled)';
}
```

**Process:**

1. **Feature check:** allowSelfSignup on Organization
2. **Validate input:** Email format, password length, name length
3. **Check duplicate:** User.findUnique({ email }) must not exist
4. **Hash password:** bcrypt.hash(password, 12)
5. **Create user:** Insert User record with passwordHash, emailVerifiedAt = null
6. **Create organization membership:** UserOrganization record (VIEWER role)
7. **Emit event:** USER_REGISTERED
8. **Send email verification:** Generate 256-bit token, email with verification link
9. **Return:** User data (not logged in yet; must verify email first)

**Email Verification:**

- Token: 256-bit random, 24-hour expiry, single-use
- Link format: `https://app.example.com/auth/verify-email?token=<token>`
- On verification: Set user.emailVerifiedAt, delete token, auto-login (create session)

---

### 3. Password Reset via Email Token

**Endpoint 1:** `POST /api/auth/forgot-password`

**Request:**

```typescript
interface ForgotPasswordRequest {
  email: string; // Must be valid email
}
```

**Response:**

```typescript
interface ForgotPasswordResponse {
  success: true;
  message: 'Password reset email sent to registered address';
}
```

**Always returns success** (even if email not found) to prevent user enumeration.

**Process:**

1. **Rate limit:** 3 reset requests per email per hour
2. **Lookup user:** User.findUnique({ email })
3. **Generate token:** 256-bit random, 1-hour expiry, single-use
4. **Store token:** PasswordResetToken record with expiresAt
5. **Send email:** Reset link: `https://app.example.com/auth/reset-password?token=<token>`
6. **Emit event:** PASSWORD_RESET_REQUESTED

---

**Endpoint 2:** `POST /api/auth/reset-password`

**Request:**

```typescript
interface ResetPasswordRequest {
  token: string; // From email link
  newPassword: string;
}
```

**Response:**

```typescript
interface ResetPasswordResponse {
  success: true;
  message: 'Password reset successful. You can now log in.';
  sessionToken?: string; // Auto-login on successful reset (optional)
}
```

**Response (Error):**

```typescript
interface ResetPasswordErrorResponse {
  success: false;
  error: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'INVALID_PASSWORD';
}
```

**Process:**

1. **Lookup token:** PasswordResetToken.findUnique({ token })
2. **Validate:** Token not null, expiresAt > now, used !== true
3. **Validate password:** Length 8-128, passes HIBP k-anonymity
4. **Hash password:** bcrypt.hash(newPassword, 12)
5. **Update user:** Set user.passwordHash
6. **Invalidate sessions:** Delete all Session records for this user (force re-auth)
7. **Mark token used:** PasswordResetToken.update({ used: true })
8. **Emit event:** PASSWORD_RESET_COMPLETED
9. **Return:** Success + optional auto-login session

---

### 4. Magic Link Login (Optional, Recommended for UX)

**Endpoint 1:** `POST /api/auth/magic-link`

**Request:**

```typescript
interface MagicLinkRequest {
  email: string;
  organizationSlug?: string;
}
```

**Response:**

```typescript
interface MagicLinkResponse {
  success: true;
  message: 'Magic link sent to your email';
}
```

**Process:**

1. **Rate limit:** 3 requests per email per hour
2. **Lookup user:** User.findUnique({ email })
3. **Account check:** user.isActive === true
4. **Generate token:** 256-bit random, 15-minute expiry, single-use
5. **Store token:** MagicLinkToken record with expiresAt, organizationSlug
6. **Send email:** Link: `https://app.example.com/auth/verify-magic-link?token=<token>`
7. **Emit event:** MAGIC_LINK_SENT

---

**Endpoint 2:** `GET /api/auth/verify-magic-link`

**Query Parameters:**

```
token=<256-bit-token>
redirect_to=/admin/dashboard (optional)
```

**Response (Success):** Redirect to redirect_to with session cookie set, then JSON response

**Response (Error):** Redirect to login with error message

**Process:**

1. **Lookup token:** MagicLinkToken.findUnique({ token })
2. **Validate:** Token not null, expiresAt > now, used !== true
3. **Mark used:** MagicLinkToken.update({ used: true })
4. **Get user:** User.findUnique({ email }) from token
5. **Create session:** Same as login flow
6. **Return:** Redirect to redirect_to or /admin/dashboard
7. **Emit event:** MAGIC_LINK_VERIFIED

**Security:** Token single-use, 15-minute window, email confirmation required (proof of email ownership).

---

### 5. Logout

**Endpoint:** `POST /api/auth/logout`

**Request:** (None, authenticated via session cookie/header)

**Response:**

```typescript
interface LogoutResponse {
  success: true;
  message: 'Logged out successfully';
}
```

**Process:**

1. **Extract session:** From cookie or Authorization header
2. **Lookup session:** Session.findUnique({ token })
3. **Delete session:** Session.delete({ id })
4. **Clear cache:** If Redis, delete session cache entry
5. **Emit event:** USER_LOGOUT (with session duration)
6. **Return:** Success
7. **Frontend:** Clear session cookie, redirect to login

---

## Password Security

### Hashing Algorithm

**Algorithm:** bcrypt with cost factor 12

```typescript
import bcrypt from 'bcryptjs';

// Hashing (registration, password change)
const hash = await bcrypt.hash(password, 12);

// Verification (login)
const matches = await bcrypt.compare(password, hash);
```

**Rationale:**

- bcrypt is slow-by-design (prevents brute force)
- Cost factor 12 ≈ 250ms per hash (acceptable UX, defensive against GPUs)
- No salt management needed (bcrypt handles it)
- Algorithm resistant to timing attacks

### Password Constraints (NIST 800-63B Compliant)

**Allowed:**

- Minimum: 8 characters
- Maximum: 128 characters
- Any Unicode character (emoji, accents, etc.)
- No composition rules (no "must have uppercase", etc.)

**Rejected:**

- Fewer than 8 characters
- More than 128 characters
- No length-based complexity rules

**Rationale:**

- NIST 800-63B recommends long, simple passwords over short, complex ones
- Length is the primary entropy driver
- Users are better at creating memorable 12-char passwords than complex 8-char ones
- Removes frustration ("why doesn't my special char work?")

### Breached Password Detection

**Service:** Have I Been Pwned (HIBP) k-anonymity API

**Process:**

1. **Non-blocking check:** On registration, password change, and login
2. **K-anonymity:** Send SHA-1(password) first 5 chars to HIBP API; get list of compromised hashes with suffix
3. **Local match:** Check if full SHA-1 is in response list
4. **Action:**
   - Registration: Reject (error 400)
   - Password change: Reject (error 400)
   - Login: Log warning event, allow login (user may have re-used password from another breach)

**Example:**

```typescript
async function checkBreachedPassword(password: string): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex');
  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const hashes = await response.text();

  return hashes.split('\r\n').some((line) => line.startsWith(suffix));
}
```

### Rate Limiting

**Login Attempts:**

- Per email: 5 attempts per minute
- Per IP: 20 attempts per minute
- Per account: After 10 failed attempts in 1 hour, return generic error ("Invalid credentials")

**Password Reset:**

- Per email: 3 requests per hour
- Per IP: 10 requests per hour

**Magic Link:**

- Per email: 3 requests per hour
- Per IP: 10 requests per hour

**Implementation:**

```typescript
// Redis key: login_attempt:{email}:{minute_bucket}
async function checkLoginRateLimit(email: string, ip: string): Promise<boolean> {
  const emailKey = `login_attempt:${email}:${Math.floor(Date.now() / 60000)}`;
  const ipKey = `login_attempt:${ip}:${Math.floor(Date.now() / 60000)}`;

  const emailCount = await redis.incr(emailKey);
  const ipCount = await redis.incr(ipKey);

  if (emailCount === 1) await redis.expire(emailKey, 60);
  if (ipCount === 1) await redis.expire(ipKey, 60);

  return emailCount <= 5 && ipCount <= 20;
}
```

---

## Session Management

### Session Token Format

**Type:** Cryptographically random 256-bit token, base64url encoded

**Generation:**

```typescript
import { randomBytes } from 'crypto';

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
```

**Length:** 43 characters (256 bits in base64url)

**Example:** `K8X-bQ1-NdPm3oZ-K8X-bQ1-NdPm3oZ-K8X-bQ1-NdE`

### Session Storage

**Primary store:** PostgreSQL `Session` table

**Cache layer:** Redis (optional; fallback to database)

**Reason for DB (not JWT):**

- Sessions can be revoked server-side (password change, role change, disable account)
- JWT cannot be revoked without maintaining a blacklist (defeats purpose)
- Database lookup is sub-millisecond with proper indexes
- Audit trail of session activity (when created, last activity, IP, user-agent)

### Session Lifetime

**Idle timeout:** 24 hours (sliding window)
**Absolute maximum:** 7 days (hard cap, regardless of activity)

**Sliding window:** Each API request that uses the session extends idle timeout by 24 hours (up to 7-day maximum)

**Example timeline:**

```
12:00 Login              → Session expires at 12:00 + 24h = 36:00 (Day 2)
13:00 Request #1         → Session expires at 13:00 + 24h = 37:00 (Day 2)
16:00 Request #2         → Session expires at 16:00 + 24h = 40:00 (Day 2)
But 7-day cap means:      Absolute expiry is Day 1 12:00 + 7d = Day 8 12:00
Day 7 10:00 Request #3   → Session expires at Day 7 10:00 + 24h but capped at Day 8 12:00
```

---

### Session Table Schema (Prisma)

```prisma
model Session {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  // Token
  token                   String        @unique @db.Char(43)  // base64url, 256 bits

  // User binding
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Organization binding (set at login)
  organizationId          String
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Lifecycle
  expiresAt               DateTime      // Hard cap: created + 7 days
  lastActivityAt          DateTime      // Updated on each request; used for idle timeout calculation
  idleExpiresAt           DateTime      // Last activity + 24 hours; compared against now() for idle check

  // Audit
  ipAddress               String?       @db.VarChar(45)     // IPv4 or IPv6
  userAgent               String?       @db.Text
  requestId               String?       @db.VarChar(36)     // Correlated with Event for audit

  // Security
  isRevoked               Boolean       @default(false)      // Set true on logout or invalidation
  revokedAt               DateTime?
  revokeReason            String?       @db.VarChar(50)     // "LOGOUT", "PASSWORD_CHANGE", "ROLE_CHANGE", etc.

  @@unique([userId, organizationId, token])
  @@index([token])
  @@index([userId])
  @@index([organizationId])
  @@index([expiresAt])
  @@index([idleExpiresAt])
  @@index([isRevoked])
}
```

### Session Refresh Mechanism

**Refresh on every request:**

```typescript
// In middleware or API route handler
async function refreshSession(session: Session): Promise<Session> {
  const now = new Date();

  // Check if idle timeout exceeded
  const idleMs = now.getTime() - session.lastActivityAt.getTime();
  if (idleMs > 24 * 60 * 60 * 1000) {
    throw new SessionExpiredError('Idle timeout');
  }

  // Check if absolute timeout exceeded
  if (now > session.expiresAt) {
    throw new SessionExpiredError('Absolute timeout');
  }

  // Extend idle timeout (sliding window)
  const newIdleExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const absoluteExpiry = new Date(session.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const updatedSession = await prisma.session.update({
    where: { id: session.id },
    data: {
      lastActivityAt: now,
      idleExpiresAt:
        newIdleExpiry.getTime() > absoluteExpiry.getTime() ? absoluteExpiry : newIdleExpiry,
    },
  });

  return updatedSession;
}
```

### Session Cookie Configuration

```typescript
const sessionCookie = {
  name: 'vaultspace-session',
  value: sessionToken,
  maxAge: 24 * 60 * 60, // 24 hours (client-side hint; server enforces hard timeout)
  httpOnly: true, // No JavaScript access
  secure: process.env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'lax', // CSRF protection: send on cross-site POST but not img/link tags
  path: '/', // Available to all paths
  domain: process.env.COOKIE_DOMAIN || undefined, // Optional: restrict to subdomain
};

response.cookie('vaultspace-session', sessionToken, sessionCookie);
```

---

## Token Specifications

### Magic Link Tokens

**Type:** 256-bit random, base64url
**Expiry:** 15 minutes
**Usage:** Single-use (deleted on verification)

**Prisma Model:**

```prisma
model MagicLinkToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  email                   String        @db.VarChar(255)
  organizationSlug        String?       @db.VarChar(100)  // If multi-org login

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?

  @@index([email])
  @@index([expiresAt])
}
```

### Password Reset Tokens

**Type:** 256-bit random, base64url
**Expiry:** 1 hour
**Usage:** Single-use (marked used after redemption)

**Prisma Model:**

```prisma
model PasswordResetToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?
  usedFromIp              String?       @db.VarChar(45)

  @@index([userId])
  @@index([expiresAt])
  @@index([used])
}
```

### Email Verification Tokens

**Type:** 256-bit random, base64url
**Expiry:** 24 hours
**Usage:** Single-use (deleted on verification)

**Prisma Model:**

```prisma
model EmailVerificationToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  newEmail                String?       @db.VarChar(255)  // If changing email, not initial signup

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?

  @@index([userId])
  @@index([expiresAt])
}
```

---

## Session Invalidation Rules

### Scenario 1: Password Change

**Trigger:** User or admin changes user's password

**Action:** Invalidate ALL sessions for that user

```typescript
async function invalidateAllSessions(userId: string, reason: string) {
  await prisma.session.updateMany({
    where: { userId },
    data: {
      isRevoked: true,
      revokedAt: new Date(),
      revokeReason: reason,
    },
  });

  // Clear Redis cache
  await redis.del(`session:${userId}:*`);

  // Emit event
  emit('ALL_SESSIONS_REVOKED', {
    userId,
    reason,
    revokedCount: result.count,
  });
}
```

**User experience:**

- User sees "You were logged out; please log in again" on all other tabs/devices
- Current request succeeds; next request fails with 401 Unauthorized
- User must log in again with new password

---

### Scenario 2: Role Change

**Trigger:** User's org role changes (VIEWER → ADMIN or vice versa)

**Action:** Invalidate ALL sessions for that user

**Reason:** Session may have cached permission checks; new role is significant security boundary.

```typescript
async function onRoleChanged(userId: string, organizationId: string) {
  await invalidateAllSessions(userId, 'ROLE_CHANGED');

  emit('USER_ROLE_CHANGED', {
    userId,
    organizationId,
  });
}
```

---

### Scenario 3: Account Disabled

**Trigger:** Admin disables user account (user.isActive = false)

**Action:** Invalidate ALL sessions for that user immediately

```typescript
async function disableUserAccount(userId: string, reason: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });

  await invalidateAllSessions(userId, 'ACCOUNT_DISABLED');

  emit('USER_ACCOUNT_DISABLED', {
    userId,
    reason,
  });
}
```

---

### Scenario 4: Logout (Current Session Only)

**Trigger:** User clicks "Log Out"

**Action:** Revoke current session only; other sessions unaffected

```typescript
async function logout(sessionId: string) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      isRevoked: true,
      revokedAt: new Date(),
      revokeReason: 'LOGOUT',
    },
  });

  // Clear Redis
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (session) {
    await redis.del(`session:${session.token}`);
  }

  emit('USER_LOGOUT', {
    sessionId,
    userId: session.userId,
    duration: Date.now() - session.createdAt.getTime(),
  });
}
```

---

### Scenario 5: Admin Force-Logout User

**Endpoint:** `POST /api/admin/users/{userId}/force-logout`

**Action:** Invalidate ALL sessions for a specific user

```typescript
async function adminForceLogout(adminUserId: string, targetUserId: string) {
  // Verify admin has permission
  const allowed = await permissionEngine.check(adminUserId, 'user:force_logout', targetUserId);
  if (!allowed) throw new ForbiddenError();

  await invalidateAllSessions(targetUserId, 'ADMIN_FORCE_LOGOUT');

  emit('ADMIN_FORCE_LOGOUT', {
    adminUserId,
    targetUserId,
  });
}
```

---

## Multi-Tenant Session Context

### Session-Organization Binding

**At login time:** Session is bound to a specific organization

```typescript
async function createSession(
  userId: string,
  organizationId: string,
  ipAddress: string,
  userAgent: string
): Promise<Session> {
  const token = generateSessionToken();

  const session = await prisma.session.create({
    data: {
      token,
      userId,
      organizationId, // Bound here
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      idleExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastActivityAt: new Date(),
      ipAddress,
      userAgent,
    },
  });

  return session;
}
```

### organizationId Never From Headers

**Rule:** Never trust `X-Organization-Id`, `org-id`, or other headers for organzation context.

```typescript
// WRONG (SECURITY BUG)
const organizationId = request.headers.get('x-organization-id');

// CORRECT
const session = await getSession(request);
const organizationId = session.organizationId; // From session only
```

### Single-Org vs Multi-Org Login

**Single org:**

```typescript
// User has one org; auto-bind
const userOrgs = await prisma.userOrganization.findMany({
  where: { userId },
  include: { organization: true },
});

if (userOrgs.length === 1) {
  // Auto-bind to single org
  return createSession(userId, userOrgs[0].organizationId, ...);
}
```

**Multi-org without slug:**

```typescript
// User has multiple orgs; return list, require selection
if (userOrgs.length > 1 && !organizationSlug) {
  return response.status(400).json({
    error: 'MULTIPLE_ORGANIZATIONS',
    organizations: userOrgs.map((uo) => ({
      id: uo.organization.id,
      slug: uo.organization.slug,
      name: uo.organization.name,
    })),
  });
}
```

**Multi-org with slug:**

```typescript
// User specified org; verify membership
const userOrg = await prisma.userOrganization.findFirst({
  where: {
    userId,
    organization: { slug: organizationSlug },
  },
  include: { organization: true },
});

if (!userOrg) throw new ForbiddenError("User not member of organization");

return createSession(userId, userOrg.organizationId, ...);
```

### Organization Switching

**To switch orgs:** User must log out and log in to different org

```
User logged into Acme Corp (session 1)
User clicks "Switch Organization"
Frontend calls POST /api/auth/logout
Frontend redirects to login with ?org=other-company
User logs in again (creates new session 2)
User is now in Other Company context
```

**Why not same-session org switching?**

- Permissions are organization-scoped; switching means different permission set
- Event audit trail is org-scoped; mixing orgs in one session breaks audit
- GDPR/compliance requires clear org boundaries

---

## Security Headers & CSRF

### CSRF Protection

**Mechanism:** SameSite cookie + Origin header validation

```typescript
// No separate CSRF token needed; SameSite=Lax provides protection

// In middleware, validate Origin for state-changing requests:
function validateCsrf(request: Request) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (request.method !== 'GET') {
    const allowed = ['https://app.example.com', 'https://subdomain.example.com'];

    if (origin && !allowed.includes(origin)) {
      throw new CsrfError('Invalid origin');
    }

    if (referer) {
      const refererUrl = new URL(referer);
      if (!allowed.includes(refererUrl.origin)) {
        throw new CsrfError('Invalid referer');
      }
    }
  }
}
```

**Why SameSite=Lax is sufficient:**

- Browser won't send cookies on cross-origin POST (unless special case)
- Origin header validation adds defense-in-depth
- No separate CSRF token state needed

### Security Response Headers

```typescript
// In middleware or Next.js config
export async function middleware(request: Request) {
  const response = NextResponse.next();

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent opening in frame
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  // XSS protection (legacy; CSP is modern)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'nonce-{random}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self';"
  );

  // HSTS (require HTTPS for 1 year)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}
```

### CORS (Same-Origin Only, MVP)

```typescript
// MVP: CORS disabled for admin/viewer UI
// Only same-origin requests allowed

// In API routes, validate origin:
function cors(request: Request, response: Response) {
  const origin = request.headers.get('origin');

  if (origin === request.headers.get('host')) {
    // Same origin; allow
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else if (process.env.ALLOWED_ORIGINS?.includes(origin)) {
    // Explicitly allowed cross-origin (for API key access, V1+)
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  return response;
}
```

---

## Prisma Models

### User Model (Authentication Fields)

```prisma
model User {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  // Authentication
  email                   String        @unique @db.VarChar(255)
  passwordHash            String        @db.VarChar(255)  // bcrypt(password, 12)

  // Profile
  firstName               String        @db.VarChar(100)
  lastName                String        @db.VarChar(100)

  // Session & security
  lastLoginAt             DateTime?
  emailVerifiedAt         DateTime?
  totpSecret              String?       // 2FA - F026 (future)

  // Account status
  isActive                Boolean       @default(true)

  // Relations
  organizations           UserOrganization[]
  sessions                Session[]
  passwordResetTokens     PasswordResetToken[]
  emailVerificationTokens EmailVerificationToken[]
  magicLinkTokens         MagicLinkToken[]  // Reverse relation for cleanup
  permissions             Permission[]
  roleAssignments         RoleAssignment[]
  groupMemberships        GroupMembership[]
  invitations             Invitation[]
  apiKeys                 ApiKey[]

  @@index([email])
  @@index([isActive])
}
```

### Session Model

```prisma
model Session {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())
  updatedAt               DateTime      @updatedAt

  // Token
  token                   String        @unique @db.Char(43)

  // User binding
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Organization binding
  organizationId          String
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Lifecycle
  expiresAt               DateTime      // Hard cap: created + 7 days
  lastActivityAt          DateTime      // Updated on each request
  idleExpiresAt           DateTime      // Last activity + 24 hours

  // Audit
  ipAddress               String?       @db.VarChar(45)
  userAgent               String?       @db.Text
  requestId               String?       @db.VarChar(36)

  // Security
  isRevoked               Boolean       @default(false)
  revokedAt               DateTime?
  revokeReason            String?       @db.VarChar(50)

  // Relation to events for audit
  events                  Event[]

  @@unique([userId, organizationId, token])
  @@index([token])
  @@index([userId])
  @@index([organizationId])
  @@index([expiresAt])
  @@index([idleExpiresAt])
  @@index([isRevoked])
}
```

### Token Models

```prisma
model MagicLinkToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  email                   String        @db.VarChar(255)
  organizationSlug        String?       @db.VarChar(100)

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?

  @@index([email])
  @@index([expiresAt])
  @@index([used])
}

model PasswordResetToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?
  usedFromIp              String?       @db.VarChar(45)

  @@index([userId])
  @@index([expiresAt])
  @@index([used])
}

model EmailVerificationToken {
  id                      String        @id @default(cuid())
  createdAt               DateTime      @default(now())

  token                   String        @unique @db.Char(43)
  userId                  String
  user                    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  newEmail                String?       @db.VarChar(255)

  expiresAt               DateTime
  used                    Boolean       @default(false)
  usedAt                  DateTime?

  @@index([userId])
  @@index([expiresAt])
  @@index([used])
}
```

---

## TypeScript Implementation Examples

### Session Creation

```typescript
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function login(
  email: string,
  password: string,
  organizationSlug: string | undefined,
  ipAddress: string,
  userAgent: string
): Promise<{ token: string; expiresAt: Date } | null> {
  // 1. Rate limit check
  const rateLimited = await checkLoginRateLimit(email, ipAddress);
  if (!rateLimited) {
    throw new Error('Too many login attempts. Try again later.');
  }

  // 2. Find user
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      organizations: {
        include: { organization: true },
      },
    },
  });

  if (!user || !user.isActive) {
    // Don't reveal if email exists
    throw new Error('Invalid credentials');
  }

  // 3. Verify password
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    emit('LOGIN_FAILED', { email, reason: 'INVALID_PASSWORD', ip: ipAddress });
    throw new Error('Invalid credentials');
  }

  // 4. Check breached password (non-blocking)
  try {
    const breached = await checkBreachedPassword(password);
    if (breached) {
      emit('BREACHED_PASSWORD_USED', { userId: user.id, email });
    }
  } catch (err) {
    // Log but don't fail login
    console.warn('HIBP check failed:', err);
  }

  // 5. Determine organization
  const userOrgs = user.organizations;
  let targetOrgId: string;

  if (userOrgs.length === 0) {
    throw new Error('User not member of any organization');
  } else if (userOrgs.length === 1) {
    targetOrgId = userOrgs[0].organizationId;
  } else if (organizationSlug) {
    const org = userOrgs.find((uo) => uo.organization.slug === organizationSlug);
    if (!org) {
      throw new Error('User not member of specified organization');
    }
    targetOrgId = org.organizationId;
  } else {
    throw new Error('MULTIPLE_ORGANIZATIONS', {
      organizations: userOrgs.map((uo) => ({
        id: uo.organization.id,
        slug: uo.organization.slug,
        name: uo.organization.name,
      })),
    });
  }

  // 6. Create session
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const idleExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      token,
      userId: user.id,
      organizationId: targetOrgId,
      expiresAt,
      idleExpiresAt,
      lastActivityAt: now,
      ipAddress,
      userAgent,
    },
  });

  // 7. Update lastLoginAt
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: now },
  });

  // 8. Emit event
  emit('USER_LOGIN', {
    userId: user.id,
    organizationId: targetOrgId,
    ip: ipAddress,
    userAgent,
  });

  return {
    token,
    expiresAt,
  };
}
```

### Session Validation Middleware

```typescript
import { Request, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const redis = createRedisClient(); // or null if not using Redis

async function validateSession(request: Request): Promise<Session | null> {
  // 1. Extract token from cookie or Authorization header
  const token =
    request.cookies.get('vaultspace-session')?.value ||
    request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!token) return null;

  // 2. Check Redis cache (if available)
  if (redis) {
    const cached = await redis.get(`session:${token}`);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  // 3. Query database
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true, organization: true },
  });

  if (!session) return null;

  // 4. Check revocation
  if (session.isRevoked) {
    return null;
  }

  // 5. Check expiration
  const now = new Date();
  if (now > session.expiresAt || now > session.idleExpiresAt) {
    // Mark as revoked
    await prisma.session.update({
      where: { id: session.id },
      data: {
        isRevoked: true,
        revokedAt: now,
        revokeReason: 'EXPIRED',
      },
    });
    return null;
  }

  // 6. Check user is active
  if (!session.user.isActive) {
    return null;
  }

  // 7. Refresh idle timeout
  const newIdleExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const absoluteExpiry = session.expiresAt;

  const actualNewIdleExpiry =
    newIdleExpiry.getTime() > absoluteExpiry.getTime() ? absoluteExpiry : newIdleExpiry;

  await prisma.session.update({
    where: { id: session.id },
    data: {
      lastActivityAt: now,
      idleExpiresAt: actualNewIdleExpiry,
    },
  });

  // 8. Update cache
  if (redis) {
    await redis.setex(`session:${token}`, 3600, JSON.stringify(session)); // 1 hour cache
  }

  return session;
}

// Middleware usage
export async function middleware(request: Request) {
  const session = await validateSession(request);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Attach to request context
  request.user = session.user;
  request.session = session;
  request.organizationId = session.organizationId;

  return NextResponse.next();
}
```

### Password Reset

```typescript
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

async function forgotPassword(email: string): Promise<void> {
  // Rate limit
  const limited = await checkPasswordResetRateLimit(email);
  if (!limited) {
    throw new Error('Too many requests. Try again later.');
  }

  // Lookup user (always succeed to prevent enumeration)
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    // Silently fail
    emit('PASSWORD_RESET_REQUESTED_NONEXISTENT', { email });
    return;
  }

  // Create token
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  // Send email
  const resetLink = `https://app.example.com/auth/reset-password?token=${token}`;
  await emailProvider.send({
    to: user.email,
    subject: 'Reset your VaultSpace password',
    template: 'password-reset',
    data: { resetLink, userName: user.firstName },
  });

  emit('PASSWORD_RESET_REQUESTED', { userId: user.id });
}

async function resetPassword(token: string, newPassword: string): Promise<void> {
  // Validate password
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new Error('Password must be 8-128 characters');
  }

  // Check breached
  const breached = await checkBreachedPassword(newPassword);
  if (breached) {
    throw new Error('This password has been exposed in data breaches');
  }

  // Find token
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!resetToken) {
    throw new Error('Invalid or expired token');
  }

  if (resetToken.expiresAt < new Date()) {
    throw new Error('Token has expired');
  }

  if (resetToken.used) {
    throw new Error('Token has already been used');
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Update user
  await prisma.$transaction([
    // Update password
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
    }),

    // Mark token used
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: {
        used: true,
        usedAt: new Date(),
      },
    }),

    // Invalidate all sessions
    prisma.session.updateMany({
      where: { userId: resetToken.userId },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
        revokeReason: 'PASSWORD_CHANGED',
      },
    }),
  ]);

  emit('PASSWORD_RESET_COMPLETED', {
    userId: resetToken.userId,
  });
}
```

### Logout

```typescript
async function logout(sessionToken: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { token: sessionToken },
  });

  if (!session) {
    throw new Error('Session not found');
  }

  const now = new Date();
  const duration = now.getTime() - session.createdAt.getTime();

  await prisma.session.update({
    where: { id: session.id },
    data: {
      isRevoked: true,
      revokedAt: now,
      revokeReason: 'LOGOUT',
    },
  });

  // Clear Redis cache
  if (redis) {
    await redis.del(`session:${sessionToken}`);
  }

  emit('USER_LOGOUT', {
    userId: session.userId,
    sessionId: session.id,
    duration,
  });
}
```

---

## API Endpoints

### Authentication Endpoints

| Method | Path                          | Purpose                         | Auth Required |
| ------ | ----------------------------- | ------------------------------- | ------------- |
| `POST` | `/api/auth/login`             | Email/password login            | No            |
| `POST` | `/api/auth/register`          | User registration               | No            |
| `POST` | `/api/auth/logout`            | Logout (revoke current session) | Yes           |
| `POST` | `/api/auth/forgot-password`   | Request password reset          | No            |
| `POST` | `/api/auth/reset-password`    | Complete password reset         | No            |
| `POST` | `/api/auth/magic-link`        | Request magic link              | No            |
| `GET`  | `/api/auth/verify-magic-link` | Verify magic link               | No            |
| `GET`  | `/api/auth/session`           | Get current session info        | Yes           |
| `POST` | `/api/auth/refresh`           | Refresh idle timeout            | Yes           |

### Admin Session Management

| Method   | Path                                     | Purpose                  | Auth Required |
| -------- | ---------------------------------------- | ------------------------ | ------------- |
| `GET`    | `/api/admin/users/{userId}/sessions`     | List user's sessions     | Yes (admin)   |
| `POST`   | `/api/admin/users/{userId}/force-logout` | Revoke all user sessions | Yes (admin)   |
| `DELETE` | `/api/admin/sessions/{sessionId}`        | Revoke specific session  | Yes (admin)   |

---

## Middleware Architecture

### Authentication Middleware

```typescript
// middleware.ts (root level, runs on all routes)

import { NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Extract session
  const session = await validateSession(request);

  // Attach to request (via custom header to API routes)
  if (session) {
    request.headers.set('x-user-id', session.userId);
    request.headers.set('x-organization-id', session.organizationId);
    request.headers.set('x-session-id', session.id);
  }

  // Protect routes
  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!session) {
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }
  }

  if (request.nextUrl.pathname.startsWith('/viewer')) {
    if (!session) {
      return NextResponse.redirect(new URL('/auth/login', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|public).*)'],
};
```

### API Route Pattern

```typescript
// app/api/rooms/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/auth';
import { RoomService } from '@/services/RoomService';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const session = await validateSession(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse and validate input
    const body = await request.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid input: name is required' }, { status: 400 });
    }

    // 3. Call service (already authorized by session.organizationId)
    const room = await RoomService.createRoom({
      organizationId: session.organizationId,
      userId: session.userId,
      name,
      description,
    });

    // 4. Return response
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    // Error handling...
  }
}
```

---

## Security Test Matrix

**Test Coverage:** All SEC-\* tests must pass before MVP release.

| Test ID | Scenario                                | Expected Behavior                           |
| ------- | --------------------------------------- | ------------------------------------------- |
| SEC-001 | Invalid session token                   | Return 401, no data leaked                  |
| SEC-002 | Expired session (idle timeout)          | Return 401, session revoked                 |
| SEC-003 | Expired session (absolute timeout)      | Return 401, session revoked                 |
| SEC-004 | Revoked session (logout)                | Return 401, session marked revoked          |
| SEC-005 | Disabled user's session                 | Return 401 on next request                  |
| SEC-006 | Password reset invalidates all sessions | All other sessions revoked                  |
| SEC-007 | Role change invalidates all sessions    | All sessions revoked, user re-auth required |
| SEC-008 | Breached password at registration       | Reject with 400                             |
| SEC-009 | Breached password at change             | Reject with 400                             |
| SEC-010 | Login rate limiting (per email)         | Block after 5 attempts/min                  |
| SEC-011 | Login rate limiting (per IP)            | Block after 20 attempts/min                 |
| SEC-012 | CSRF attempt (cross-origin POST)        | Reject if origin invalid                    |
| SEC-013 | organizationId from header              | Ignore header, use session.organizationId   |
| SEC-014 | Session cookie HttpOnly                 | JavaScript cannot access token              |
| SEC-015 | Session cookie Secure (prod)            | Only sent over HTTPS                        |
| SEC-016 | Session cookie SameSite=Lax             | Not sent on cross-site requests             |

---

## Cross-References

- **DATABASE_SCHEMA.md:** User, Session, MagicLinkToken, PasswordResetToken, EmailVerificationToken models
- **ARCHITECTURE.md:** Authentication Middleware, Security Architecture sections
- **PERMISSION_MODEL.md:** Session-based authorization context
- **EVENT_MODEL.md:** USER_LOGIN, USER_LOGOUT, PASSWORD_RESET_COMPLETED events
- **SECURITY.md:** Breach reporting, vulnerability handling
- **AI_BUILD_PLAYBOOK.md:** MVP scope, testing requirements

---

**Document Status:** Specification Complete, Ready for Implementation
**Next Steps:** Implement endpoints in `app/api/auth/`, create Session/Token models in Prisma, add middleware to `src/middleware.ts`
