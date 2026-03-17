# Contributing to VaultSpace

Thank you for your interest in contributing to VaultSpace! We welcome contributions of all kinds: code, documentation, bug reports, feature requests, and more.

---

## Table of Contents

1. [Welcome & Code of Conduct](#welcome--code-of-conduct)
2. [Getting Started](#getting-started)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Adding a New Provider/Adapter](#adding-a-new-provideradapter)
8. [Documentation](#documentation)
9. [Issue & PR Labels](#issue--pr-labels)
10. [License](#license)

---

## Welcome & Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please review our [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating.

**tl;dr:** Be respectful, inclusive, and constructive. Report concerns to the maintainers.

---

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20+ LTS** - Download from [nodejs.org](https://nodejs.org/)
- **npm** - Included with Node.js
- **Docker & Docker Compose** - Download from [docker.com](https://www.docker.com/)
- **Git** - Download from [git-scm.com](https://git-scm.com/)

Verify your setup:

```bash
node --version      # Should be v20.x or higher
npm --version       # Should be v10.x or higher
docker --version    # Should be v20.x or higher
docker compose --version  # Should be v2.x or higher
git --version       # Should be v2.x or higher
```

### Fork and Clone

1. **Fork the repository** on GitHub by clicking the "Fork" button at the top-right of the repo page.

2. **Clone your fork:**

   ```bash
   git clone https://github.com/YOUR_USERNAME/vaultspace.git
   cd vaultspace
   ```

3. **Add the upstream remote:**
   ```bash
   git remote add upstream https://github.com/vaultspace/vaultspace.git
   ```

### Local Development Setup

1. **Start the Docker Compose stack** (PostgreSQL, Redis, Gotenberg for previews):

   ```bash
   docker compose up -d
   ```

   This starts:
   - **PostgreSQL 15+** on `localhost:5432`
   - **Redis** on `localhost:6379`
   - **Gotenberg** on `localhost:3001` (for document preview conversion)

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up the database:**

   ```bash
   npm run db:migrate
   ```

   This runs all pending migrations and generates the Prisma client.

4. **Start the development server:**

   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:3000`.

5. **(Optional) Seed demo data:**

   ```bash
   npm run db:seed
   ```

   This populates the database with sample organizations, users, and rooms for testing.

### Default Credentials

After seeding, you can log in with:

- **Email:** `admin@example.com`
- **Password:** `dev-password` (insecure; dev-only)

**Note:** Never use these credentials in production.

---

## Project Structure

VaultSpace follows a layered architecture. For a detailed explanation, see [ARCHITECTURE.md](ARCHITECTURE.md).

### High-Level Directory Layout

```
vaultspace/
├── src/
│   ├── app/                      # Next.js App Router pages and layouts
│   │   ├── admin/                # Admin UI (rooms, users, settings, analytics)
│   │   ├── viewer/               # Viewer UI (document display, watermarks)
│   │   ├── auth/                 # Login, logout, SSO callbacks
│   │   ├── api/                  # API routes (thin wrappers around services)
│   │   └── public/               # Public share pages
│   ├── lib/
│   │   ├── providers/            # Provider/adapter implementations (storage, email, etc.)
│   │   ├── db/                   # Prisma client, migrations, middleware
│   │   ├── utils/                # Shared utilities, helpers
│   │   └── constants/            # App-wide constants
│   ├── services/                 # CoreService layer (business logic)
│   │   ├── DocumentService.ts
│   │   ├── RoomService.ts
│   │   ├── PermissionService.ts
│   │   └── ...
│   ├── workers/                  # Background job workers (preview, scan, etc.)
│   └── components/               # Reusable React components
├── prisma/
│   ├── schema.prisma             # Database schema
│   ├── migrations/               # Auto-generated migration files
│   └── seed.ts                   # Seed script for demo data
├── public/                       # Static assets (logos, icons)
├── tests/                        # Test files (unit, integration, e2e)
├── docker-compose.yml            # Local dev environment
└── package.json                  # Dependencies and scripts
```

For more detail, see **"Directory Structure"** in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Development Workflow

### 1. Branch Naming Convention

Use one of these prefixes:

- `feature/xxx` - New feature (e.g., `feature/watermark-settings`)
- `fix/xxx` - Bug fix (e.g., `fix/permissions-check`)
- `docs/xxx` - Documentation (e.g., `docs/api-guide`)
- `refactor/xxx` - Code refactoring (e.g., `refactor/event-bus`)
- `test/xxx` - Test improvements (e.g., `test/coverage-increase`)
- `chore/xxx` - Maintenance (e.g., `chore/dependency-update`)

Example:

```bash
git checkout -b feature/password-reset
```

### 2. Commit Message Format

We follow **Conventional Commits** for clear, scannable commit history.

Format:

```
<type>(<scope>): <subject>

<body (optional)>

<footer (optional)>
```

**Types:**

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring (no behavior change)
- `test:` - Test additions or fixes
- `chore:` - Build, CI, or dependency updates
- `perf:` - Performance improvements

**Scope (optional):** The module or feature affected (e.g., `auth`, `storage`, `api`).

**Subject:** Imperative, lowercase, no period. Max 50 characters.

**Examples:**

```
feat(auth): add password reset flow
fix(permissions): correct multi-tenant scoping
docs(contributing): update setup instructions
refactor(storage): consolidate provider interfaces
test(document): add validation edge cases
```

### 3. Pull Request Process

1. **Create a pull request** from your branch to `main` (or the default branch).

2. **Fill out the PR template** with:
   - Clear description of changes
   - Related issue number(s) (e.g., `Closes #123`)
   - Testing approach
   - Screenshots (if UI changes)

3. **Ensure all checks pass:**
   - CI pipeline (tests, linting, type checking)
   - At least one maintainer approval
   - Branch is up-to-date with `main`

4. **Address review feedback** by pushing new commits. Do not force-push unless requested.

5. **Squash commits** if asked by maintainers (we'll handle this during merge if needed).

---

## Coding Standards

### TypeScript

- **Strict mode is enforced.** `tsconfig.json` has `"strict": true`.
- Use explicit types; avoid `any` unless absolutely necessary and documented.
- Type all function parameters and return types.

Example:

```typescript
// ✓ Good
function createRoom(name: string, orgId: string): Promise<Room> {
  // ...
}

// ✗ Bad
function createRoom(name, orgId) {
  // ...
}
```

### Linting & Formatting

- **ESLint** validates code quality (unused variables, naming conventions, etc.).
- **Prettier** enforces consistent code style.

Run before committing:

```bash
npm run lint             # Run ESLint
npm run format           # Run Prettier (auto-fix)
npm run type-check       # Run TypeScript compiler
```

Or enable auto-format-on-save in your editor (VS Code: install Prettier + ESLint extensions).

### Architectural Patterns

#### CoreService Layer

All business logic must go in the `src/services/` layer. API routes should be thin wrappers that delegate to services.

**Pattern:**

```typescript
// src/services/DocumentService.ts
class DocumentService {
  async upload(input: UploadInput, actor: Actor): Promise<Document> {
    // 1. Authorize
    await this.permissionEngine.check(actor, 'document.create', input.roomId);

    // 2. Validate
    if (!input.file) throw new ValidationError('File required');

    // 3. Execute
    const document = await this.db.document.create({...});

    // 4. Emit event
    await this.eventBus.emit('document.uploaded', {...});

    // 5. Queue jobs
    await this.jobQueue.enqueue('preview', {...});

    return document;
  }
}

// app/api/documents/route.ts (thin wrapper)
export async function POST(request: NextRequest) {
  const actor = await authenticateRequest(request);
  const input = await request.json();

  const documentService = getDocumentService();
  const document = await documentService.upload(input, actor);

  return response.created(document);
}
```

#### EventBus

All state changes must emit events for audit trail, webhooks, and analytics.

```typescript
// Emit after every important action
await this.eventBus.emit('room.created', {
  roomId: room.id,
  actorId: actor.id,
  metadata: { roomName: input.name },
});
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full event emission pattern.

#### Multi-Tenancy

All queries must include `organization_id` filtering.

```typescript
// ✓ Good
const rooms = await this.db.room.findMany({
  where: {
    organization_id: actor.organizationId,
  },
});

// ✗ Bad (missing org scoping)
const rooms = await this.db.room.findMany();
```

Prisma middleware auto-applies tenant scoping to common query patterns (see [ARCHITECTURE.md](ARCHITECTURE.md) for details).

#### Provider/Adapter Pattern

External integrations use provider interfaces. Implementations are selected via environment variables.

For example:

```typescript
// lib/providers/storage/StorageProvider.ts (interface)
interface StorageProvider {
  uploadFile(key: string, data: Buffer): Promise<UploadResult>;
  downloadFile(key: string): Promise<Buffer>;
  getSignedUrl(key: string, expiresIn: number): Promise<string>;
}

// lib/providers/storage/S3StorageProvider.ts (implementation)
class S3StorageProvider implements StorageProvider {
  // AWS S3 implementation
}

// lib/providers/factory.ts (selection)
function createStorageProvider(): StorageProvider {
  const provider = process.env.STORAGE_PROVIDER;
  if (provider === 's3') return new S3StorageProvider(...);
  if (provider === 'local') return new LocalStorageProvider(...);
  // ...
}
```

When adding new integrations, follow this pattern. See [Adding a New Provider/Adapter](#adding-a-new-provideradapter) for a step-by-step guide.

---

## Testing

### Test Frameworks

- **Vitest** - Fast unit test runner (React/Node.js compatible)
- **Playwright** - E2E browser testing
- Test database - Isolated PostgreSQL schema per test suite

### Test Structure

```
tests/
├── unit/                         # Unit tests (services, utils)
│   ├── services/
│   │   ├── DocumentService.test.ts
│   │   └── PermissionService.test.ts
│   └── utils/
├── integration/                  # Integration tests (with real DB)
│   ├── api/
│   │   └── documents.test.ts
│   └── services/
├── e2e/                          # End-to-end tests (Playwright)
│   ├── admin-login.spec.ts
│   └── document-upload.spec.ts
└── fixtures/                     # Test data and helpers
```

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm test unit

# Integration tests only
npm test integration

# E2E tests only
npm test e2e

# Watch mode (unit/integration)
npm test -- --watch

# Coverage report
npm test -- --coverage
```

### Test Naming Conventions

Use clear, descriptive test names:

```typescript
// ✓ Good
describe('DocumentService.upload', () => {
  it('should create document and emit event when authorized', async () => {
    // ...
  });

  it('should reject upload if user lacks permissions', async () => {
    // ...
  });

  it('should reject upload if file exceeds size limit', async () => {
    // ...
  });
});

// ✗ Bad
describe('upload', () => {
  it('works', async () => {
    // ...
  });

  it('fails', async () => {
    // ...
  });
});
```

### Coverage Expectations

- **New features:** Aim for **≥80% coverage** of new code
- **Bug fixes:** Include regression tests
- **Critical paths:** Prioritize coverage of auth, permissions, and data access

Use `npm test -- --coverage` to generate a coverage report.

---

## Adding a New Provider/Adapter

Providers/adapters are the primary extension point. Common examples: storage backends (S3, Azure), email services (SendGrid, AWS SES), or authentication (OIDC, SAML).

### Step 1: Define the Interface

If a provider interface doesn't exist, create one in `lib/providers/<type>/`:

```typescript
// lib/providers/email/EmailProvider.ts
export interface EmailProvider {
  send(request: SendEmailRequest): Promise<SendEmailResult>;
  sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult>;
  verifyEmail(email: string): Promise<boolean>;
}

export interface SendEmailRequest {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailResult {
  id: string;
  status: 'sent' | 'failed' | 'queued';
  error?: string;
}
```

### Step 2: Implement the Interface

Create a new implementation file:

```typescript
// lib/providers/email/SendGridEmailProvider.ts
import { EmailProvider, SendEmailRequest, SendEmailResult } from './EmailProvider';

export class SendGridEmailProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(request: SendEmailRequest): Promise<SendEmailResult> {
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: request.to }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL },
          subject: request.subject,
          content: [{ type: 'text/html', value: request.html }],
        }),
      });

      if (!response.ok) {
        return { id: '', status: 'failed', error: await response.text() };
      }

      return { id: response.headers.get('X-Message-ID') || '', status: 'sent' };
    } catch (error) {
      return { id: '', status: 'failed', error: String(error) };
    }
  }

  async sendTemplate(
    to: string,
    templateId: string,
    data: Record<string, string>
  ): Promise<SendEmailResult> {
    // Implementation for template-based sending
    // ...
  }

  async verifyEmail(email: string): Promise<boolean> {
    // Implementation for email verification
    // ...
  }
}
```

### Step 3: Add Environment Variable Configuration

Document the required environment variables in `.env.example`:

```bash
# Email Provider Configuration
EMAIL_PROVIDER=sendgrid        # Options: smtp, sendgrid, azure, aws-ses
SENDGRID_API_KEY=***
SENDGRID_FROM_EMAIL=noreply@example.com
```

### Step 4: Register in the Provider Factory

Add selection logic to the factory:

```typescript
// lib/providers/email/factory.ts
import { EmailProvider } from './EmailProvider';
import { SmtpEmailProvider } from './SmtpEmailProvider';
import { SendGridEmailProvider } from './SendGridEmailProvider';

export function createEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER || 'smtp';

  switch (provider) {
    case 'sendgrid':
      return new SendGridEmailProvider(process.env.SENDGRID_API_KEY || '');

    case 'smtp':
      return new SmtpEmailProvider({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
      });

    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}
```

### Step 5: Add Tests

Create unit and integration tests:

```typescript
// tests/unit/providers/SendGridEmailProvider.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SendGridEmailProvider } from '@/lib/providers/email/SendGridEmailProvider';

describe('SendGridEmailProvider', () => {
  let provider: SendGridEmailProvider;

  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'test-key';
    provider = new SendGridEmailProvider('test-key');
  });

  it('should send email successfully', async () => {
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    });

    expect(result.status).toBe('sent');
    expect(result.id).toBeTruthy();
  });

  it('should handle send failures gracefully', async () => {
    // Mock API error and test error handling
    const result = await provider.send({
      to: 'invalid',
      subject: 'Test',
      html: '<p>Test</p>',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBeTruthy();
  });
});
```

### Step 6: Update Documentation

Add the new provider to the relevant documentation:

- **ARCHITECTURE.md:** List it under the provider section
- **README.md:** Add setup instructions in the deployment section
- **.env.example:** Include example configuration

### Example: Complete Checklist

- [ ] Interface defined or reused
- [ ] Implementation class created and tested
- [ ] Environment variables documented in `.env.example`
- [ ] Factory updated with provider selection logic
- [ ] Unit tests passing (`npm test unit`)
- [ ] Integration tests passing (if applicable)
- [ ] Documentation updated (ARCHITECTURE.md, README.md)
- [ ] PR description explains the provider and use case

---

## Documentation

### When to Update Docs

- **New feature:** Add to feature list and usage guide
- **API change:** Update API documentation
- **New provider:** Document setup and configuration
- **Bug fix:** Update docs if behavior clarification needed
- **Architecture change:** Update ARCHITECTURE.md

### Where to Document

- **ARCHITECTURE.md** - System design, layers, providers, directory structure
- **README.md** - Overview, quick start, feature list
- **API.md** (if applicable) - REST endpoint reference
- **DEPLOYMENT.md** - Production deployment, Docker, Kubernetes
- **Inline comments** - Non-obvious logic, rationale for decisions

### Documentation Style

- Use **Markdown** with clear headings
- Include **code examples** where helpful
- Keep it **DRY** - reference existing sections rather than duplicating
- Use **present tense** ("the service validates..." not "the service will validate...")

---

## Issue & PR Labels

We use labels for organization and triage. Here are the standard labels:

### Type

- `type/feature` - Feature request or implementation
- `type/bug` - Bug report or fix
- `type/docs` - Documentation
- `type/refactor` - Code refactoring
- `type/performance` - Performance improvement

### Priority

- `priority/critical` - Blocks other work or production issue
- `priority/high` - Important, should be done soon
- `priority/medium` - Normal priority (default)
- `priority/low` - Nice-to-have, can wait

### Status

- `status/needs-review` - Awaiting review
- `status/in-progress` - Active development
- `status/blocked` - Blocked by other issue/PR
- `status/ready-to-merge` - Approved and ready

### Category

- `category/auth` - Authentication and authorization
- `category/storage` - File storage and management
- `category/admin` - Admin UI and operations
- `category/viewer` - Viewer UI and document display
- `category/api` - API routes and integration
- `category/database` - Database schema and migrations
- `category/testing` - Test infrastructure and coverage

### Other

- `good-first-issue` - Good starting point for new contributors
- `help-wanted` - Seeking community contribution
- `duplicate` - Duplicate of another issue
- `invalid` - Not a valid issue or off-topic

---

## License

VaultSpace is licensed under **AGPLv3** (GNU Affero General Public License v3).

By contributing, you agree that your contributions will be licensed under the same AGPLv3 license. This means:

- **You retain copyright** of your work
- **Derivative works must also be open-source** (AGPLv3 or compatible)
- **Network use is distribution** (AGPL requirement: if you modify VaultSpace and run it on a server, users accessing it can request the modified source code)

### Contributor License Agreement (CLA)

For larger contributions, we may request a CLA. This is optional but recommended. It ensures clarity about contributions and protects both you and the project.

---

## Getting Help

- **Questions?** Open a [discussion](https://github.com/vaultspace/vaultspace/discussions) or ask in the community Slack
- **Found a bug?** [Create an issue](https://github.com/vaultspace/vaultspace/issues/new?template=bug_report.md) with reproduction steps
- **Have an idea?** [Start a discussion](https://github.com/vaultspace/vaultspace/discussions/new) or [create a feature request](https://github.com/vaultspace/vaultspace/issues/new?template=feature_request.md)

---

## Thank You!

We appreciate all contributions, big and small. Your effort helps make VaultSpace better for everyone. Happy coding!

---

**Last Updated:** 2026-03-14
