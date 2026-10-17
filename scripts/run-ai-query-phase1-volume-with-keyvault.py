"""Run guarded synthetic volume QA with in-memory Munger staging credentials."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys


def qa_module():
    path = Path(__file__).with_name("run-ai-query-qa-with-keyvault.py")
    spec = importlib.util.spec_from_file_location("ai_qa_launcher", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("AI QA launcher unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) == 2 else ""
    if mode not in {"--prepare", "--measure"}:
        print("Use exactly --prepare or --measure", file=sys.stderr)
        return 2
    qa = qa_module()
    account = subprocess.run(
        ["az", "account", "show", "--subscription", qa.SUBSCRIPTION,
         "--query", "id", "-o", "tsv"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    if account.stdout.strip() != qa.SUBSCRIPTION_ID:
        raise RuntimeError("Munger subscription target mismatch")
    server = qa.discover_one(["postgres", "flexible-server", "list"])
    vault = qa.discover_one(["keyvault", "list"])
    storage = qa.discover_one(["storage", "account", "list"])
    host = server.get("fullyQualifiedDomainName", "")
    if not host.endswith(".postgres.database.azure.com") or "staging" not in host:
        raise RuntimeError("Staging PostgreSQL target mismatch")
    env = os.environ.copy()
    env.update(
        DATABASE_URL=qa.secret(vault["name"], qa.SECRET_NAMES["DATABASE_URL"]),
        DATABASE_URL_ADMIN=qa.secret(vault["name"], qa.SECRET_NAMES["DATABASE_URL_ADMIN"]),
        AI_QA_SUBSCRIPTION_ID=qa.SUBSCRIPTION_ID,
        AI_QA_STAGING_DB_HOST=host,
        ENABLE_RLS="true",
    )
    if mode == "--prepare":
        env["AZURE_STORAGE_ACCOUNT_NAME"] = storage["name"]
        env["AZURE_STORAGE_ACCOUNT_KEY"] = qa.secret(
            vault["name"], qa.SECRET_NAMES["AZURE_STORAGE_ACCOUNT_KEY"]
        )
        env["AI_QA_VOLUME_CONFIRM"] = "synthetic-staging-only"
    result = subprocess.run(
        ["npx", "tsx", "scripts/ai-query-phase1-volume-qa.ts", mode],
        env=env, capture_output=True, text=True, timeout=1200,
    )
    for line in (result.stdout + "\n" + result.stderr).splitlines():
        print(qa.redact(line)[:600])
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"AI volume launcher failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
