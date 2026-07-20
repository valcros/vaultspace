/**
 * RLS Startup Guard
 *
 * Verifies that the runtime database role (DATABASE_URL) does not carry
 * BYPASSRLS. Called once during server startup from instrumentation.ts.
 *
 * The admin role (DATABASE_URL_ADMIN) is expected to have BYPASSRLS for
 * cross-tenant operations like login/registration. The *runtime* role used
 * for ordinary request handling must NOT bypass RLS or tenant isolation is
 * unenforced at the database layer.
 */

type RlsGuardResult =
  | { status: 'ok'; roleName: string }
  | { status: 'bypassing'; roleName: string }
  | { status: 'error'; message: string };

export async function checkRlsRole(): Promise<RlsGuardResult> {
  try {
    const { db } = await import('@/lib/db');
    const rows = await db.$queryRaw<Array<{ rolname: string; rolbypassrls: boolean }>>`
      SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (!rows[0]) {
      return { status: 'error', message: 'Could not determine current database role' };
    }
    const { rolname, rolbypassrls } = rows[0];
    return rolbypassrls
      ? { status: 'bypassing', roleName: rolname }
      : { status: 'ok', roleName: rolname };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
