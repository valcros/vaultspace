import { describe, expect, it } from 'vitest';
import { globSync } from 'glob';
import { readFileSync } from 'fs';

describe('SysOp Guard Coverage Invariant (P0 #1a)', () => {
  it('every /api/sysop route module invokes requirePlatformOperator()', () => {
    const routes = globSync('src/app/api/sysop/**/route.ts');
    expect(routes.length).toBeGreaterThan(0);

    for (const routePath of routes) {
      const content = readFileSync(routePath, 'utf8');
      expect(
        content,
        `Route file ${routePath} is missing requirePlatformOperator() authorization guard`
      ).toMatch(/requirePlatformOperator\s*\(/);
    }
  });

  it('SysOp layout explicitly gates on user.isPlatformOperator', () => {
    const layoutContent = readFileSync('src/app/sysop/layout.tsx', 'utf8');
    expect(layoutContent).toMatch(/user\.isPlatformOperator/);
  });
});
