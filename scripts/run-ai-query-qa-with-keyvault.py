"""Run the guarded AI QA fixture loader with in-memory staging credentials.

This launcher never writes credentials to disk or prints their values. It uses
the current Azure CLI login, explicitly targets Munger subscription 1, and
passes Key Vault values only through the child process environment.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys


SUBSCRIPTION_ID = "041a67eb-fec8-41a4-9d70-c35863268cd6"
SUBSCRIPTION = "Munger subscription 1"
SECRET_NAMES = {
    "DATABASE_URL": "database-url-anfix",
    "DATABASE_URL_ADMIN": "database-url-admin-anfix",
    "REDIS_URL": "redis-url",
    "AZURE_STORAGE_ACCOUNT_KEY": "azure-storage-key",
}
ALLOWED = {"--plan", "--apply", "--verify", "--remove-plan", "--remove"}


def discover_one(command: list[str]) -> dict:
    result = subprocess.run(
        ["az", *command, "--subscription", SUBSCRIPTION, "-o", "json"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    candidates = [
        item for item in json.loads(result.stdout)
        if "vaultspace" in item.get("name", "").lower()
        and "staging" in item.get("name", "").lower()
    ]
    if len(candidates) != 1:
        raise RuntimeError("Expected exactly one VaultSpace staging resource of this type")
    return candidates[0]


def secret(vault: str, name: str) -> str:
    result = subprocess.run(
        [
            "az", "keyvault", "secret", "show", "--vault-name", vault,
            "--name", name, "--subscription", SUBSCRIPTION,
            "--query", "value", "-o", "tsv",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    return result.stdout.strip()


def redact(line: str) -> str:
    line = re.sub(r"(?i)(postgres(?:ql)?|rediss?)://\S+", "[redacted-url]", line)
    line = re.sub(r"(?i)(password|key|token)=\S+", "[redacted-credential]", line)
    return line


def main() -> int:
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    if command not in ALLOWED:
        print("Use exactly one of --plan, --apply, --verify, --remove-plan, or --remove", file=sys.stderr)
        return 2
    env = os.environ.copy()
    if command != "--plan":
        account = subprocess.run(
            ["az", "account", "show", "--subscription", SUBSCRIPTION,
             "--query", "id", "-o", "tsv"],
            capture_output=True, text=True, check=True, timeout=30,
        )
        if account.stdout.strip() != SUBSCRIPTION_ID:
            raise RuntimeError("Azure CLI is not targeting Munger subscription 1")
        server = discover_one(["postgres", "flexible-server", "list"])
        vault = discover_one(["keyvault", "list"])
        storage = discover_one(["storage", "account", "list"])
        host = server.get("fullyQualifiedDomainName", "")
        if not host.endswith(".postgres.database.azure.com"):
            raise RuntimeError("Discovered staging server has no expected PostgreSQL domain")
        needed = ["DATABASE_URL", "DATABASE_URL_ADMIN"]
        if command in {"--apply", "--remove"}:
            needed.append("AZURE_STORAGE_ACCOUNT_KEY")
        if command == "--apply":
            needed.append("REDIS_URL")
        for key in needed:
            env[key] = secret(vault["name"], SECRET_NAMES[key])
        env.update(
            AI_QA_SUBSCRIPTION_ID=SUBSCRIPTION_ID,
            AI_QA_STAGING_DB_HOST=host,
            AZURE_STORAGE_ACCOUNT_NAME=storage["name"],
            ENABLE_RLS="true",
        )
    result = subprocess.run(
        ["npx", "tsx", "scripts/ai-query-qa-fixtures.ts", command],
        env=env, capture_output=True, text=True, timeout=360,
    )
    for line in (result.stdout + "\n" + result.stderr).splitlines():
        print(redact(line)[:600])
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"AI QA launcher failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
