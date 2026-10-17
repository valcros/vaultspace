"""Bounded vector feasibility benchmark in the isolated Azure staging database.

The script connects only to vaultspace_aiqa_bench on the known staging server.
It creates 5,000 deterministic 1,536-dimensional vectors in its own table,
compares exact and HNSW results, and prints metadata-only evidence. It never
queries or mutates the VaultSpace application database.
"""

from __future__ import annotations

import json
import os
import statistics
import subprocess
from urllib.parse import unquote, urlparse


SUBSCRIPTION = "Munger subscription 1"
SUBSCRIPTION_ID = "041a67eb-fec8-41a4-9d70-c35863268cd6"
DATABASE = "vaultspace_aiqa_bench"
DIMENSIONS = 1536
ROWS = 5000
PROBE_IDS = [17, 121, 407, 809, 1111, 1601, 2203, 2909, 3701, 4507]


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


def pg_environment() -> dict[str, str]:
    account = subprocess.run(
        ["az", "account", "show", "--subscription", SUBSCRIPTION,
         "--query", "id", "-o", "tsv"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    if account.stdout.strip() != SUBSCRIPTION_ID:
        raise RuntimeError("Azure CLI subscription mismatch")
    server = discover_one(["postgres", "flexible-server", "list"])
    vault = discover_one(["keyvault", "list"])
    host = server.get("fullyQualifiedDomainName", "")
    if not host.endswith(".postgres.database.azure.com"):
        raise RuntimeError("Discovered staging server has no expected PostgreSQL domain")
    secret = subprocess.run(
        ["az", "keyvault", "secret", "show", "--vault-name", vault["name"],
         "--name", "database-url-admin-anfix", "--subscription", SUBSCRIPTION,
         "--query", "value", "-o", "tsv"],
        capture_output=True, text=True, check=True, timeout=30,
    )
    url = urlparse(secret.stdout.strip())
    if url.hostname != host or url.path != "/vaultspace":
        raise RuntimeError("Staging PostgreSQL source URL mismatch")
    env = os.environ.copy()
    env.update(
        PGHOST=host,
        PGPORT=str(url.port or 5432),
        PGUSER=unquote(url.username or ""),
        PGPASSWORD=unquote(url.password or ""),
        PGDATABASE=DATABASE,
        PGSSLMODE="require",
        PGCONNECT_TIMEOUT="10",
    )
    return env


def psql(env: dict[str, str], sql: str, timeout: int = 90) -> str:
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
        env=env, capture_output=True, text=True, timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError("Benchmark SQL failed; inspect the isolated database")
    return result.stdout.strip()


def vector_for(row_id: int) -> str:
    return "[" + ",".join(
        str(((row_id * 131 + dimension * 73) % 1009) / 1009)
        for dimension in range(1, DIMENSIONS + 1)
    ) + "]"


def explain(env: dict[str, str], row_id: int, indexed: bool) -> tuple[float, list[str]]:
    probe = vector_for(row_id)
    settings = (
        "SET enable_seqscan=off; SET hnsw.ef_search=200;"
        if indexed else "SET enable_indexscan=off; SET enable_bitmapscan=off;"
    )
    sql = (
        f"{settings} EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) "
        "SELECT id, org_id FROM aiqa_vectors "
        f"WHERE org_id=1 ORDER BY embedding <=> '{probe}'::vector LIMIT 8"
    )
    plan = json.loads(psql(env, sql, timeout=50))[0]
    index_names: list[str] = []

    def collect(node: dict) -> None:
        if node.get("Index Name"):
            index_names.append(str(node["Index Name"]))
        for child in node.get("Plans", []):
            collect(child)

    collect(plan["Plan"])
    return float(plan["Execution Time"]), index_names


def result_ids(env: dict[str, str], row_id: int, indexed: bool) -> list[int]:
    probe = vector_for(row_id)
    settings = (
        "SET enable_seqscan=off; SET hnsw.ef_search=200;"
        if indexed else "SET enable_indexscan=off; SET enable_bitmapscan=off;"
    )
    sql = (
        f"{settings} SELECT id FROM aiqa_vectors WHERE org_id=1 "
        f"ORDER BY embedding <=> '{probe}'::vector LIMIT 8"
    )
    return [int(value) for value in psql(env, sql, timeout=50).splitlines() if value]


def main() -> None:
    env = pg_environment()
    version = psql(env, "SELECT extversion FROM pg_extension WHERE extname='vector'")
    if not version:
        raise RuntimeError("vector extension is not installed in isolated benchmark database")
    psql(env, """
        CREATE TABLE IF NOT EXISTS aiqa_vectors (
          id integer PRIMARY KEY,
          org_id integer NOT NULL,
          room_id integer NOT NULL,
          embedding vector(1536) NOT NULL
        );
    """)
    psql(env, f"""
        INSERT INTO aiqa_vectors (id, org_id, room_id, embedding)
        SELECT row_id,
               CASE WHEN row_id % 5 = 0 THEN 2 ELSE 1 END,
               row_id % 10,
               ('[' || array_to_string(ARRAY(
                 SELECT (((row_id * 131 + dimension * 73) % 1009)::numeric / 1009)::text
                 FROM generate_series(1, {DIMENSIONS}) AS dimension
               ), ',') || ']')::vector(1536)
        FROM generate_series(1, {ROWS}) AS row_id
        ON CONFLICT (id) DO NOTHING;
    """, timeout=180)
    count = int(psql(env, "SELECT count(*) FROM aiqa_vectors"))
    if count != ROWS:
        raise RuntimeError("Unexpected isolated benchmark row count")
    exact_times = [explain(env, row_id, False)[0] for row_id in PROBE_IDS]
    psql(env, """
        CREATE INDEX IF NOT EXISTS aiqa_vectors_hnsw
        ON aiqa_vectors USING hnsw (embedding vector_cosine_ops)
        WITH (m = 8, ef_construction = 40);
        ANALYZE aiqa_vectors;
    """, timeout=240)
    indexed = [explain(env, row_id, True) for row_id in PROBE_IDS]
    recalls = []
    for row_id in PROBE_IDS:
        exact = set(result_ids(env, row_id, False))
        approximate = set(result_ids(env, row_id, True))
        recalls.append(len(exact & approximate) / max(1, len(exact)))
    leak = int(psql(env, f"""
        SELECT count(*) FROM (
          SELECT id, org_id FROM aiqa_vectors WHERE org_id=1
          ORDER BY embedding <=> '{vector_for(PROBE_IDS[0])}'::vector LIMIT 8
        ) AS result WHERE org_id <> 1;
    """))
    indexed_times = [item[0] for item in indexed]
    index_names = sorted({name for _, names in indexed for name in names})
    evidence = {
        "database": DATABASE,
        "postgresVectorVersion": version,
        "rows": count,
        "dimensions": DIMENSIONS,
        "probes": len(PROBE_IDS),
        "exactP95ServerMs": round(sorted(exact_times)[-1], 2),
        "hnswP95ServerMs": round(sorted(indexed_times)[-1], 2),
        "hnswMedianServerMs": round(statistics.median(indexed_times), 2),
        "minimumRecallAt8": round(min(recalls), 3),
        "meanRecallAt8": round(statistics.mean(recalls), 3),
        "crossTenantRows": leak,
        "usedIndexNames": index_names,
    }
    if "aiqa_vectors_hnsw" not in index_names:
        raise RuntimeError("HNSW index was not used")
    print(json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"pgvector feasibility benchmark failed: {type(error).__name__}")
        raise SystemExit(1)
