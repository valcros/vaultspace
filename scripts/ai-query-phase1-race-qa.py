"""Check the AI indexer lock and policy-purge ordering on one synthetic staging room.

Run only with AI_QA_RACE_CONFIRM=synthetic-staging-only. This intentionally
disables the lifecycle fixture room's AI policy; re-enable and reconcile it
with ai-query-phase1-qa.ts after collecting the result.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import unquote, urlparse


ORG_ID = "cmvclck990000x7oeepbmmpa8"
ROOM_ID = "cmvclcmg0000mx7oe3djr72nf"
LOCK_APP = "vaultspace-aiqa-lock-holder"


def launcher():
    path = Path(__file__).with_name("run-ai-query-qa-with-keyvault.py")
    spec = importlib.util.spec_from_file_location("ai_qa_launcher", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("AI QA launcher unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def psql(env: dict[str, str], sql: str, timeout: int = 30) -> str:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError("Synthetic race SQL failed")
    return result.stdout.strip()


def pg_env(module) -> dict[str, str]:
    account = subprocess.run(
        ["az", "account", "show", "--subscription", module.SUBSCRIPTION,
         "--query", "id", "-o", "tsv"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    if account.stdout.strip() != module.SUBSCRIPTION_ID:
        raise RuntimeError("Munger subscription target mismatch")
    server = module.discover_one(["postgres", "flexible-server", "list"])
    vault = module.discover_one(["keyvault", "list"])
    url = urlparse(module.secret(vault["name"], module.SECRET_NAMES["DATABASE_URL_ADMIN"]))
    host = server.get("fullyQualifiedDomainName", "")
    if (
        url.hostname != host
        or "staging" not in host
        or not host.endswith(".postgres.database.azure.com")
        or url.path != "/vaultspace"
    ):
        raise RuntimeError("Staging database target mismatch")
    env = os.environ.copy()
    env.update(
        PGHOST=host,
        PGPORT=str(url.port or 5432),
        PGDATABASE="vaultspace",
        PGUSER=unquote(url.username or ""),
        PGPASSWORD=unquote(url.password or ""),
        PGSSLMODE="require",
        PGCONNECT_TIMEOUT="10",
    )
    return env


def main() -> None:
    if os.environ.get("AI_QA_RACE_CONFIRM") != "synthetic-staging-only":
        raise RuntimeError("Synthetic staging race confirmation required")
    env = pg_env(launcher())
    identity = psql(env, f"""
      SELECT o.name || '|' || o.slug || '|' || r.name || '|' || r.slug
      FROM organizations o JOIN rooms r ON r."organizationId"=o.id
      WHERE o.id='{ORG_ID}' AND r.id='{ROOM_ID}'
    """)
    if identity != (
        "VaultSpace AI QA Synthetic|vaultspace-ai-qa-synthetic|"
        "AI QA Version Lifecycle|ai-qa-version-lifecycle"
    ):
        raise RuntimeError("Synthetic lifecycle identity mismatch")
    before = psql(env, f"""
      SELECT (SELECT count(*) FROM ai_policies WHERE "roomId"='{ROOM_ID}' AND enabled),
             (SELECT count(*) FROM ai_sources WHERE "roomId"='{ROOM_ID}' AND state='READY'),
             (SELECT count(*) FROM ai_chunks WHERE "roomId"='{ROOM_ID}'),
             (SELECT count(*) FROM documents WHERE "roomId"='{ROOM_ID}')
    """)
    policy, sources, chunks, documents = map(int, before.split("|"))
    if (policy != 1 or sources != 1 or chunks < 1 or documents != 1):
        raise RuntimeError("Synthetic lifecycle corpus is not ready")

    # Match the indexer's lock order. The source update represents a committed
    # index write immediately before a concurrent policy disable.
    lock_sql = f"""
      BEGIN;
      SELECT id FROM organizations WHERE id='{ORG_ID}' FOR SHARE;
      SELECT id FROM rooms WHERE id='{ROOM_ID}' AND "organizationId"='{ORG_ID}' FOR SHARE;
      SELECT id FROM ai_policies WHERE "roomId"='{ROOM_ID}' AND "organizationId"='{ORG_ID}' FOR SHARE;
      SELECT id FROM documents WHERE "roomId"='{ROOM_ID}' AND "organizationId"='{ORG_ID}' FOR UPDATE;
      SELECT v.id FROM document_versions v JOIN documents d ON d."currentVersionId"=v.id
        WHERE d."roomId"='{ROOM_ID}' AND d."organizationId"='{ORG_ID}' FOR SHARE OF v;
      SELECT b.id FROM file_blobs b JOIN document_versions v ON v.id=b."versionId"
        JOIN documents d ON d."currentVersionId"=v.id
        WHERE d."roomId"='{ROOM_ID}' AND d."organizationId"='{ORG_ID}' FOR SHARE OF b;
      UPDATE ai_sources SET "updatedAt"=now() WHERE "roomId"='{ROOM_ID}' AND "organizationId"='{ORG_ID}';
      SELECT pg_sleep(8);
      COMMIT;
    """
    holder_env = dict(env, PGAPPNAME=LOCK_APP)
    holder = subprocess.Popen(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", lock_sql],
        env=holder_env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    disabler = None
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            sleeping = psql(env, f"""
              SELECT count(*) FROM pg_stat_activity
              WHERE application_name='{LOCK_APP}' AND wait_event='PgSleep'
            """)
            if sleeping == "1":
                break
            if holder.poll() is not None:
                raise RuntimeError("Index lock holder exited before the race")
            time.sleep(0.25)
        else:
            raise RuntimeError("Index lock holder did not reach the sleep barrier")

        disable_sql = f"""
          UPDATE ai_policies SET enabled=false, "updatedAt"=now()
          WHERE "roomId"='{ROOM_ID}' AND "organizationId"='{ORG_ID}' AND enabled=true
        """
        started = time.monotonic()
        disabler = subprocess.Popen(
            ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", disable_sql],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        time.sleep(1)
        blocked = disabler.poll() is None
        disable_output, disable_error = disabler.communicate(timeout=20)
        waited_ms = round((time.monotonic() - started) * 1000)
        holder_output, holder_error = holder.communicate(timeout=20)
        if holder.returncode or disabler.returncode:
            raise RuntimeError("Concurrent synthetic SQL transaction failed")
        if not blocked or waited_ms < 4000:
            raise RuntimeError("Policy disable did not wait for index locks")
        # Keep SQL outputs out of logs, even though they contain only fixture IDs.
        _ = holder_output, holder_error, disable_output, disable_error
        after = psql(env, f"""
          SELECT (SELECT count(*) FROM ai_policies WHERE "roomId"='{ROOM_ID}' AND enabled),
                 (SELECT count(*) FROM ai_sources WHERE "roomId"='{ROOM_ID}'),
                 (SELECT count(*) FROM ai_chunks WHERE "roomId"='{ROOM_ID}'),
                 (SELECT count(*) FROM documents WHERE "roomId"='{ROOM_ID}')
        """)
        if after != "0|0|0|1":
            raise RuntimeError("Concurrent disable did not purge synthetic corpus")
        print(f"synthetic lock wait ms={waited_ms}; policy=0; sources=0; chunks=0; documents=1")
    finally:
        if disabler is not None and disabler.poll() is None:
            disabler.terminate()
            disabler.communicate(timeout=5)
        if holder.poll() is None:
            holder.terminate()
            holder.communicate(timeout=5)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"Synthetic AI race QA failed: {type(error).__name__}")
        raise SystemExit(1)
