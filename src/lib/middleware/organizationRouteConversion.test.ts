import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const convertedFiles = [
  'src/lib/middleware/auth.ts',
  'src/lib/middleware/customDomain.ts',
  'src/app/api/public/branding/route.ts',
  'src/app/org/[slug]/page.tsx',
];

describe('W1-2 organization route conversion source boundary', () => {
  it('removes direct administrative database access from every converted surface', () => {
    for (const file of convertedFiles) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/\bbootstrapDb\b/);
    }
  });

  it('routes slug, custom-domain, branding, and landing lookups through the repository', () => {
    const auth = readFileSync(join(process.cwd(), 'src/lib/middleware/auth.ts'), 'utf8');
    const customDomain = readFileSync(
      join(process.cwd(), 'src/lib/middleware/customDomain.ts'),
      'utf8'
    );
    const branding = readFileSync(
      join(process.cwd(), 'src/app/api/public/branding/route.ts'),
      'utf8'
    );
    const landing = readFileSync(join(process.cwd(), 'src/app/org/[slug]/page.tsx'), 'utf8');

    expect(auth).toContain('bootstrapRepository.resolveOrganizationBySlug');
    expect(auth).toContain('bootstrapRepository.resolveOrganizationByCustomDomain');
    expect(customDomain).toContain('bootstrapRepository.resolveOrganizationBySlug');
    expect(customDomain).toContain('bootstrapRepository.resolveOrganizationByCustomDomain');
    expect(branding).toContain('resolveOrganizationFromHeaders(customDomain)');
    expect(landing).toContain('bootstrapRepository.resolveOrganizationBySlug(slug)');
  });

  it('does not change the session mutation implementation in this unit', () => {
    const session = readFileSync(join(process.cwd(), 'src/lib/auth/session.ts'), 'utf8');

    expect(session).toContain('await bootstrapDb.session.update({');
    expect(session).toContain('const tokens = await deactivateSessions(db, { token });');
  });
});
