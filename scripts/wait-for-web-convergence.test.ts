import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const helperPath = `${repositoryRoot}/scripts/wait-for-web-convergence.sh`;
const targetRelease = 'a'.repeat(40);
const targetRevision = 'vaultspace-web--target';
const targetImage = `registry.example.com/vaultspace-web@sha256:${'1'.repeat(64)}`;

const mockAz = `#!/usr/bin/env bash
set -euo pipefail
arguments="$*"

if [[ "$arguments" == *"containerapp show"* ]] && [[ "$arguments" == *"properties.latestRevisionName"* ]]; then
  printf 'attempt\\n' >> "$MOCK_ATTEMPT_LOG"
  printf '%s\\n' "$MOCK_REVISION"
elif [[ "$arguments" == *"containerapp revision show"* ]]; then
  printf '%s\\n' "$MOCK_WEB_IMAGE"
elif [[ "$arguments" == *"containerapp revision list"* ]]; then
  attempt_count=$(wc -l < "$MOCK_ATTEMPT_LOG")
  if [ "$MOCK_ACTIVE_MODE" = "eventual" ] && [ "$attempt_count" -gt 1 ]; then
    printf '["%s"]\\n' "$MOCK_REVISION"
  else
    printf '["%s","vaultspace-web--old"]\\n' "$MOCK_REVISION"
  fi
elif [[ "$arguments" == *"containerapp ingress traffic show"* ]]; then
  printf '[{"revisionName":"%s","weight":%s}]\\n' "$MOCK_REVISION" "$MOCK_TRAFFIC_WEIGHT"
else
  printf 'unexpected az invocation: %s\\n' "$arguments" >&2
  exit 1
fi
`;

const mockCurl = `#!/usr/bin/env bash
set -euo pipefail
header_file=""
body_file=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -D)
      header_file="$2"
      shift 2
      ;;
    -o)
      body_file="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf 'HTTP/1.1 200 OK\\r\\ncache-control: %s\\r\\n\\r\\n' "$MOCK_CACHE_CONTROL" > "$header_file"
printf '{"status":"%s","revision":"%s","release":"%s","passwordResetRecovery":{"deliveryContractVersion":1}}\\n' \\
  "$MOCK_HEALTH_STATUS" "$MOCK_HEALTH_REVISION" "$MOCK_HEALTH_RELEASE" > "$body_file"
`;

type ConvergenceOverrides = Partial<{
  activeMode: 'eventual' | 'persistent';
  image: string;
  trafficWeight: string;
  cacheControl: string;
  healthRelease: string;
  healthRevision: string;
  healthStatus: string;
  maxAttempts: string;
}>;

function runConvergence(overrides: ConvergenceOverrides = {}) {
  const mockDirectory = mkdtempSync(join(tmpdir(), 'vaultspace-web-convergence-'));
  const attemptLog = join(mockDirectory, 'attempts.log');
  const azPath = join(mockDirectory, 'az');
  const curlPath = join(mockDirectory, 'curl');

  writeFileSync(attemptLog, '');
  writeFileSync(azPath, mockAz);
  writeFileSync(curlPath, mockCurl);
  chmodSync(azPath, 0o755);
  chmodSync(curlPath, 0o755);

  return spawnSync('bash', [helperPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      APP_URL: 'https://vaultspace.example',
      DEPLOY_SHA: targetRelease,
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_ID: '12345',
      MOCK_ACTIVE_MODE: overrides.activeMode ?? 'eventual',
      MOCK_ATTEMPT_LOG: attemptLog,
      MOCK_CACHE_CONTROL: overrides.cacheControl ?? 'no-store, max-age=0',
      MOCK_HEALTH_RELEASE: overrides.healthRelease ?? targetRelease,
      MOCK_HEALTH_REVISION: overrides.healthRevision ?? targetRevision,
      MOCK_HEALTH_STATUS: overrides.healthStatus ?? 'healthy',
      MOCK_REVISION: targetRevision,
      MOCK_TRAFFIC_WEIGHT: overrides.trafficWeight ?? '100',
      MOCK_WEB_IMAGE: overrides.image ?? targetImage,
      PATH: `${mockDirectory}:${process.env['PATH'] ?? ''}`,
      RESOURCE_GROUP: 'synthetic-resource-group',
      RUNNER_TEMP: mockDirectory,
      TARGET_WEB_IMAGE_PINNED: targetImage,
      WEB_CONTAINER_APP: 'synthetic-web-app',
      WEB_CONTAINER_NAME: 'synthetic-web-container',
      WEB_CONVERGENCE_MAX_ATTEMPTS: overrides.maxAttempts ?? '2',
      WEB_CONVERGENCE_RETRY_SECONDS: '0',
      WEB_CONVERGENCE_TIMEOUT_SECONDS: '30',
    },
  });
}

describe('forward web convergence retry', () => {
  it('retries an initial dual-active snapshot and passes only after sole-active convergence', () => {
    const result = runConvergence();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Web convergence not ready (attempt 1/2)');
    expect(result.stdout).toContain('sole active');
    expect(result.stdout).toContain('after attempt 2');
  });

  it('fails when dual-active state persists through the bounded attempts', () => {
    const result = runConvergence({ activeMode: 'persistent' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Web convergence not ready (attempt 2/2)');
    expect(result.stderr).toContain('did not satisfy the strict convergence contract');
    expect(`${result.stdout}${result.stderr}`).toContain('sole active revision');
  });

  it.each([
    ['wrong release', { healthRelease: 'b'.repeat(40) }],
    [
      'wrong immutable image',
      { image: `registry.example.com/vaultspace-web@sha256:${'2'.repeat(64)}` },
    ],
    ['wrong traffic', { trafficWeight: '50' }],
    ['wrong health revision', { healthRevision: 'vaultspace-web--other' }],
    ['unhealthy quick health', { healthStatus: 'degraded' }],
    ['cacheable quick health', { cacheControl: 'max-age=60' }],
  ])('keeps %s fail-closed across retries', (_name, overrides) => {
    const result = runConvergence({ ...overrides, maxAttempts: '2' });

    expect(result.status).toBe(1);
    expect(result.stdout.match(/Web convergence not ready/g)).toHaveLength(2);
    expect(result.stderr).toContain('did not satisfy the strict convergence contract');
  });
});
