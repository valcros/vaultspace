import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const verifierPath = `${repositoryRoot}/scripts/verify-password-reset-deployment-contract.mjs`;
const workerRevisionReadyPath = `${repositoryRoot}/scripts/worker-revision-ready.sh`;
const containerEnvValidatorPath = `${repositoryRoot}/scripts/validate-container-env.sh`;
const targetRevision = 'a'.repeat(40);
const rollbackRevision = 'b'.repeat(40);

function labels(revision: string) {
  return {
    'org.vaultspace.password-reset-delivery-contract-version': '1',
    'org.opencontainers.image.revision': revision,
  };
}

function image(repository: string, revision: string, digestCharacter: string) {
  return {
    reference: `registry.example.com/${repository}:${revision}`,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    labels: labels(revision),
  };
}

function validInput() {
  const rollbackWeb = image('vaultspace-web', rollbackRevision, '3');
  return {
    target: {
      expectedRevision: targetRevision,
      web: image('vaultspace-web', targetRevision, '1'),
      worker: image('vaultspace-worker', targetRevision, '2'),
    },
    rollback: {
      web: rollbackWeb,
      worker: image('vaultspace-worker', rollbackRevision, '4'),
      reconciler: image('vaultspace-worker', rollbackRevision, '5'),
    },
    serving: {
      activeWebRevisions: ['vaultspace-web--stable'],
      traffic: [{ revisionName: 'vaultspace-web--stable', weight: 100 }],
      latestRevisionName: 'vaultspace-web--stable',
      capturedRevision: 'vaultspace-web--stable',
      capturedImage: rollbackWeb.reference,
      currentRevisionImage: rollbackWeb.reference,
    },
    health: {
      cacheControl: 'no-store, max-age=0',
      body: {
        revision: 'vaultspace-web--stable',
        release: rollbackRevision,
        passwordResetRecovery: { deliveryContractVersion: 1 },
      },
    },
  };
}

function verify(input: unknown) {
  return spawnSync(process.execPath, [verifierPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

function workerRevisionReady(
  active: string,
  health: string,
  provisioning: string,
  running: string,
  replicas: number | string,
  minReplicas: number | string,
  activeRevisions: number | string
) {
  return spawnSync(
    workerRevisionReadyPath,
    [
      active,
      health,
      provisioning,
      running,
      String(replicas),
      String(minReplicas),
      String(activeRevisions),
    ],
    { encoding: 'utf8' }
  );
}

function workerImageRepository(imageReference: string) {
  return spawnSync(
    'bash',
    [
      '-c',
      'source "$1"; image_repository "$2"',
      'image-repository-test',
      containerEnvValidatorPath,
      imageReference,
    ],
    { encoding: 'utf8' }
  );
}

function validateContainerEnv(workerImage: string) {
  const sharedNames = [
    'NODE_ENV',
    'APP_URL',
    'SESSION_SECRET',
    'DATABASE_URL',
    'REDIS_URL',
    'STORAGE_PROVIDER',
    'AZURE_STORAGE_ACCOUNT_NAME',
    'AZURE_STORAGE_ACCOUNT_KEY',
    'EMAIL_PROVIDER',
    'ACS_CONNECTION_STRING',
    'ACS_SENDER_ADDRESS',
    'SCAN_ENGINE',
  ];
  const secretNames = new Set([
    'SESSION_SECRET',
    'DATABASE_URL',
    'DATABASE_URL_ADMIN',
    'REDIS_URL',
    'AZURE_STORAGE_ACCOUNT_KEY',
    'ACS_CONNECTION_STRING',
  ]);
  const envEntry = (name: string) =>
    secretNames.has(name)
      ? { name, secretRef: `synthetic-${name.toLowerCase()}` }
      : { name, value: `synthetic-${name.toLowerCase()}` };
  const webEnv = [...sharedNames, 'DATABASE_URL_ADMIN'].map(envEntry);
  const workerEnv = [...sharedNames, 'WORKER_TYPE'].map(envEntry);
  const controlledAzure = `
az() {
  local app=""
  local query=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name)
        app="$2"
        shift 2
        ;;
      --query)
        query="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  if [[ "$query" == *".probes | [0]"* ]]; then
    printf '%s\n' '[{"tcpSocket":{"port":3000}}]'
  elif [[ "$query" == *"ENABLE_RLS"* ]]; then
    printf '%s\n' 'false'
  elif [[ "$query" == *"[0].image"* ]]; then
    printf '%s\n' "$MOCK_WORKER_IMAGE"
  elif [ "$query" = "properties.template.containers[0].env" ]; then
    if [ "$app" = "synthetic-web" ]; then
      printf '%s\n' "$MOCK_WEB_ENV"
    else
      printf '%s\n' "$MOCK_WORKER_ENV"
    fi
  else
    printf '%s\n' 'null'
  fi
}
export -f az
"$1" synthetic-rg synthetic-web synthetic-worker synthetic-worker
`;

  return spawnSync(
    'bash',
    ['-c', controlledAzure, 'container-env-direct-test', containerEnvValidatorPath],
    {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env['PATH'] ?? '',
        MOCK_WEB_ENV: JSON.stringify(webEnv),
        MOCK_WORKER_ENV: JSON.stringify(workerEnv),
        MOCK_WORKER_IMAGE: workerImage,
      },
    }
  );
}

function validConvergence() {
  const revision = 'vaultspace-web--verified';
  const expectedImage = `registry.example.com/vaultspace-web@sha256:${'8'.repeat(64)}`;
  return {
    convergence: {
      revision,
      image: expectedImage,
      expectedImage,
      expectedRelease: targetRevision,
      activeWebRevisions: [revision],
      traffic: [{ revisionName: revision, weight: 100 }] as Array<{
        revisionName?: string;
        latestRevision?: boolean;
        weight: number;
      }>,
      latestRevisionName: revision,
      cacheControl: 'no-store, max-age=0',
      healthBody: {
        revision,
        release: targetRevision,
        passwordResetRecovery: { deliveryContractVersion: 1 },
      },
    },
  };
}

describe('password reset deployment contract verifier', () => {
  it('accepts a fully bound version 1 deployment and emits digest-pinned references', () => {
    const result = verify(validInput());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      TARGET_WEB_IMAGE_PINNED: `registry.example.com/vaultspace-web@sha256:${'1'.repeat(64)}`,
      TARGET_WORKER_IMAGE_PINNED: `registry.example.com/vaultspace-worker@sha256:${'2'.repeat(64)}`,
      PREVIOUS_WEB_IMAGE_PINNED: `registry.example.com/vaultspace-web@sha256:${'3'.repeat(64)}`,
      PREVIOUS_WORKER_IMAGE_PINNED: `registry.example.com/vaultspace-worker@sha256:${'4'.repeat(64)}`,
      PREVIOUS_RESET_RECONCILER_IMAGE_PINNED: `registry.example.com/vaultspace-worker@sha256:${'5'.repeat(64)}`,
      PREVIOUS_WEB_RELEASE: rollbackRevision,
      VERIFIED_PASSWORD_RESET_CONTRACT_VERSION: '1',
    });
  });

  it('pins a verified runnable manifest while retaining an immutable index digest', () => {
    const input = validInput();
    const rootDigest = `sha256:${'6'.repeat(64)}`;
    const runnableDigest = `sha256:${'7'.repeat(64)}`;
    input.target.web.reference = `registry.example.com/vaultspace-web@${rootDigest}`;
    input.target.web.digest = rootDigest;
    Object.assign(input.target.web, { runnableDigest });

    const result = verify(input);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).TARGET_WEB_IMAGE_PINNED).toBe(
      `registry.example.com/vaultspace-web@${runnableDigest}`
    );
  });

  it.each([
    [
      'missing target contract label',
      (input: ReturnType<typeof validInput>) => {
        delete (input.target.web.labels as Record<string, string>)[
          'org.vaultspace.password-reset-delivery-contract-version'
        ];
      },
    ],
    [
      'wrong target revision label',
      (input: ReturnType<typeof validInput>) => {
        input.target.worker.labels['org.opencontainers.image.revision'] = rollbackRevision;
      },
    ],
    [
      'rollback worker mismatch',
      (input: ReturnType<typeof validInput>) => {
        input.rollback.worker.labels['org.opencontainers.image.revision'] = targetRevision;
        input.rollback.worker.reference = `registry.example.com/vaultspace-worker:${targetRevision}`;
      },
    ],
    [
      'rollback reconciler mismatch',
      (input: ReturnType<typeof validInput>) => {
        input.rollback.reconciler!.labels['org.opencontainers.image.revision'] = targetRevision;
        input.rollback.reconciler!.reference = `registry.example.com/vaultspace-worker:${targetRevision}`;
      },
    ],
    [
      'multiple active web revisions',
      (input: ReturnType<typeof validInput>) => {
        input.serving.activeWebRevisions.push('vaultspace-web--old');
      },
    ],
    [
      'split positive traffic',
      (input: ReturnType<typeof validInput>) => {
        input.serving.traffic = [
          { revisionName: 'vaultspace-web--stable', weight: 90 },
          { revisionName: 'vaultspace-web--old', weight: 10 },
        ];
      },
    ],
    [
      'health revision mismatch',
      (input: ReturnType<typeof validInput>) => {
        input.health.body.revision = 'vaultspace-web--other';
      },
    ],
    [
      'health release mismatch',
      (input: ReturnType<typeof validInput>) => {
        input.health.body.release = targetRevision;
      },
    ],
    [
      'missing no-store',
      (input: ReturnType<typeof validInput>) => {
        input.health.cacheControl = 'max-age=60';
      },
    ],
    [
      'numeric zero contract',
      (input: ReturnType<typeof validInput>) => {
        input.health.body.passwordResetRecovery.deliveryContractVersion = 0;
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const input = validInput();
    mutate(input);

    const result = verify(input);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('password reset deployment contract verification failed');
  });

  it('rejects a string-valued contract version', () => {
    const input = validInput();
    Object.assign(input.health.body.passwordResetRecovery, { deliveryContractVersion: '1' });

    expect(verify(input).status).toBe(1);
  });

  it('rejects malformed verification JSON without echoing its contents', () => {
    const sentinel = 'sensitive-input-sentinel';
    const result = spawnSync(process.execPath, [verifierPath], {
      input: `{not-json:${sentinel}`,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(sentinel);
  });

  it('accepts convergence when a 100 percent latest traffic alias resolves to the verified revision', () => {
    const input = validConvergence();
    input.convergence.traffic = [{ latestRevision: true, weight: 100 }];

    const result = verify(input);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      VERIFIED_WEB_REVISION: input.convergence.revision,
    });
  });

  it.each([
    [
      'traffic assigned to another revision',
      (input: ReturnType<typeof validConvergence>) => {
        input.convergence.traffic = [{ revisionName: 'vaultspace-web--old', weight: 100 }];
      },
    ],
    [
      'health from another revision',
      (input: ReturnType<typeof validConvergence>) => {
        input.convergence.healthBody.revision = 'vaultspace-web--old';
      },
    ],
    [
      'an unknown rollback release',
      (input: ReturnType<typeof validConvergence>) => {
        input.convergence.healthBody.release = 'unknown';
      },
    ],
    [
      'multiple active revisions',
      (input: ReturnType<typeof validConvergence>) => {
        input.convergence.activeWebRevisions.push('vaultspace-web--old');
      },
    ],
  ])('rejects post-mutation %s', (_name, mutate) => {
    const input = validConvergence();
    mutate(input);

    expect(verify(input).status).toBe(1);
  });
});

describe('worker revision readiness', () => {
  it.each([
    ['running at its minimum', 'Running', 1, 1],
    ['running above a zero minimum', 'Running', 1, 0],
    ['running at its configured maximum', 'RunningAtMaxScale', 1, 0],
    ['healthy scale to zero', 'ScaledToZero', 0, 0],
  ])('accepts %s', (_name, running, replicas, minReplicas) => {
    expect(
      workerRevisionReady('true', 'Healthy', 'Provisioned', running, replicas, minReplicas, 1)
        .status
    ).toBe(0);
  });

  it.each([
    ['inactive', 'false', 'Healthy', 'Provisioned', 'Running', 1, 0, 1],
    ['unhealthy', 'true', 'Unhealthy', 'Provisioned', 'Running', 1, 0, 1],
    ['unprovisioned', 'true', 'Healthy', 'Provisioning', 'Running', 1, 0, 1],
    ['activating', 'true', 'Healthy', 'Provisioned', 'Activating', 1, 0, 1],
    ['processing', 'true', 'Healthy', 'Provisioned', 'Processing', 1, 0, 1],
    ['stopped', 'true', 'Healthy', 'Provisioned', 'Stopped', 0, 0, 1],
    ['degraded', 'true', 'Healthy', 'Provisioned', 'Degraded', 1, 0, 1],
    ['failed', 'true', 'Healthy', 'Provisioned', 'Failed', 0, 0, 1],
    ['unknown', 'true', 'Healthy', 'Provisioned', 'Unknown', 0, 0, 1],
    ['missing state', 'true', 'Healthy', 'Provisioned', '', 0, 0, 1],
    ['running with no replica', 'true', 'Healthy', 'Provisioned', 'Running', 0, 0, 1],
    ['under minimum', 'true', 'Healthy', 'Provisioned', 'Running', 1, 2, 1],
    [
      'scale to zero with required replica',
      'true',
      'Healthy',
      'Provisioned',
      'ScaledToZero',
      0,
      1,
      1,
    ],
    [
      'scale to zero with contradictory replica',
      'true',
      'Healthy',
      'Provisioned',
      'ScaledToZero',
      1,
      0,
      1,
    ],
    ['no active revision', 'true', 'Healthy', 'Provisioned', 'Running', 1, 0, 0],
    ['multiple active revisions', 'true', 'Healthy', 'Provisioned', 'Running', 1, 0, 2],
    ['nonnumeric replica count', 'true', 'Healthy', 'Provisioned', 'Running', 'unknown', 0, 1],
  ])(
    'rejects %s',
    (_name, active, health, provisioning, running, replicas, minReplicas, activeRevisions) => {
      expect(
        workerRevisionReady(
          active,
          health,
          provisioning,
          running,
          replicas,
          minReplicas,
          activeRevisions
        ).status
      ).toBe(1);
    }
  );
});

describe('container environment worker image repository validation', () => {
  it.each([
    [
      'a tagged ACR reference',
      `acrvaultspacestaging.azurecr.io/vaultspace-worker:${targetRevision}`,
    ],
    [
      'a digest-pinned ACR reference',
      `acrvaultspacestaging.azurecr.io/vaultspace-worker@sha256:${'1'.repeat(64)}`,
    ],
    [
      'a tagged registry reference with a port',
      `registry.example.com:5000/team/vaultspace-worker:${targetRevision}`,
    ],
  ])('extracts vaultspace-worker from %s', (_name, imageReference) => {
    const result = workerImageRepository(imageReference);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('vaultspace-worker');
  });

  it.each([
    `acrvaultspacestaging.azurecr.io/vaultspace-web@sha256:${'2'.repeat(64)}`,
    `acrvaultspacestaging.azurecr.io/team/vaultspace-worker-lookalike:${targetRevision}`,
  ])(
    'does not collapse a different repository into the worker repository: %s',
    (imageReference) => {
      const result = workerImageRepository(imageReference);

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).not.toBe('vaultspace-worker');
    }
  );

  it('accepts a digest-pinned worker image through direct validator execution', () => {
    const result = validateContainerEnv(
      `acrvaultspacestaging.azurecr.io/vaultspace-worker@sha256:${'3'.repeat(64)}`
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: image repo is vaultspace-worker');
    expect(result.stdout).toContain('Validation passed');
  });

  it('rejects a different repository through direct validator execution', () => {
    const result = validateContainerEnv(
      `acrvaultspacestaging.azurecr.io/vaultspace-web@sha256:${'4'.repeat(64)}`
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("repo 'vaultspace-web'");
    expect(result.stdout).toContain("expected the 'vaultspace-worker' image");
    expect(result.stdout).toContain('Validation failed: 1 error(s) found');
  });
});

describe('staging deployment workflow boundary', () => {
  const deployWorkflow = readFileSync(
    `${repositoryRoot}/.github/workflows/deploy-staging.yml`,
    'utf8'
  );
  const ciWorkflow = readFileSync(`${repositoryRoot}/.github/workflows/ci.yml`, 'utf8');
  const rollout = readFileSync(
    `${repositoryRoot}/docs/password-reset-delivery-contract-rollout.md`,
    'utf8'
  );

  it('stamps both deployable images with the same contract and source revision labels', () => {
    expect(
      ciWorkflow.match(/org\.vaultspace\.password-reset-delivery-contract-version=1/g)
    ).toHaveLength(2);
    expect(
      ciWorkflow.match(/org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/g)
    ).toHaveLength(2);
  });

  it('restricts manual dispatch and performs the fail-closed gate before every mutation class', () => {
    expect(deployWorkflow).toContain(
      "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
    );
    const gate = deployWorkflow.indexOf('- name: Verify password reset delivery contract boundary');
    expect(gate).toBeGreaterThan(0);
    for (const mutation of [
      'npm run db:migrate',
      'DEPLOYMENT_MUTATED=true',
      '--mode single',
      '--revision-weight',
      'az containerapp update \\',
      'az containerapp job update \\',
    ]) {
      expect(deployWorkflow.indexOf(mutation)).toBeGreaterThan(gate);
    }
  });

  it('requires uncached health identity, current and target artifacts, and digest-pinned outputs', () => {
    expect(deployWorkflow).toContain('curl -fsS --max-time 15');
    expect(deployWorkflow).toContain('Cache-Control: no-cache');
    expect(deployWorkflow).toContain('deployment_gate=');
    expect(deployWorkflow).toContain('.platform.os == "linux"');
    expect(deployWorkflow).toContain('.platform.architecture == "amd64"');
    expect(deployWorkflow).toContain('expected exactly one linux/amd64 runnable image manifest');
    expect(deployWorkflow).toContain('PREVIOUS_RESET_RECONCILER_METADATA');
    expect(deployWorkflow).toContain('TARGET_WEB_IMAGE_PINNED');
    expect(deployWorkflow).toContain('TARGET_WORKER_IMAGE_PINNED');
    expect(deployWorkflow).toContain('PREVIOUS_WEB_IMAGE_PINNED');
    expect(deployWorkflow).toContain('PREVIOUS_WORKER_IMAGE_PINNED');
    expect(deployWorkflow).toContain('scripts/verify-password-reset-deployment-contract.mjs');
    expect(
      deployWorkflow.match(/node scripts\/verify-password-reset-deployment-contract\.mjs/g)
    ).toHaveLength(3);
    expect(deployWorkflow).toContain('post_deploy_gate=');
    expect(deployWorkflow).toContain('recovery_gate=');
    expect(deployWorkflow).toContain('RECOVERY_ACTIVE_WEB_REVISIONS');
  });

  it('uses quick production health and validates the real reset reconciler job', () => {
    expect(deployWorkflow).not.toContain('deep=true');
    expect(deployWorkflow).toContain(
      'api/health?deployment_gate=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${ATTEMPT}'
    );
    expect(deployWorkflow).toContain(
      'api/health?recovery_gate=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${ATTEMPT}'
    );
    expect(deployWorkflow.match(/-H "Cache-Control: no-cache"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(deployWorkflow.match(/-H "Pragma: no-cache"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(deployWorkflow).toContain('the actual job validation and preflight are authoritative');
    expect(deployWorkflow).toContain("grep -Eq '^(\\*|\\*/([1-9]|1[0-5])) \\* \\* \\* \\*$'");
    expect(deployWorkflow).toContain(
      'password reset reconciler must run at least every fifteen minutes'
    );
    expect(deployWorkflow).not.toContain('[ "$CURRENT_RECONCILER_ENABLED" != "true" ] ||');
    expect(deployWorkflow).not.toContain('[ "$RESET_RECONCILER_ENABLED" != "true" ] ||');
    expect(deployWorkflow).toContain('ERROR: reconciler and worker $key references do not match');
    expect(deployWorkflow).not.toContain(
      'ERROR: reconciler, web, and worker DATABASE_URL references do not match'
    );
    expect(deployWorkflow).toContain(
      'ERROR: reconciler, web, and worker password reset recovery key references do not match'
    );
    expect(deployWorkflow).toContain(
      'ERROR: reconciler, web, and worker password reset recovery active key IDs do not match'
    );
    expect(deployWorkflow).toContain(
      'ERROR: password reset reconciler must not have DATABASE_URL_ADMIN'
    );
    expect(deployWorkflow).not.toContain(
      'for forbidden in APP_URL SESSION_SECRET DATABASE_URL_ADMIN PASSWORD_RESET_RECOVERY_KEYS'
    );
    expect(deployWorkflow).toContain(
      '[ "$COMMAND" != "npm" ] || [ "$ARGS" != "run worker:password-reset-reconcile" ]'
    );
    expect(deployWorkflow).toContain('--query properties.template');
    expect(deployWorkflow).toContain('--yaml "$EXECUTION_TEMPLATE"');
    expect(deployWorkflow).toContain('["run", "worker:password-reset-preflight"]');
    expect(deployWorkflow).not.toContain('["npm", "run", "worker:password-reset-preflight"]');
    expect(deployWorkflow).toContain('[ "$TEMPLATE_COMMAND" != "npm" ] || \\');
    expect(deployWorkflow).toContain(
      '[ "$TEMPLATE_ARGS" != "run worker:password-reset-reconcile" ]'
    );
    expect(deployWorkflow).toContain('[ "$EXECUTION_COMMAND" != "npm" ] || \\');
    expect(deployWorkflow).toContain(
      '[ "$EXECUTION_ARGS" != "run worker:password-reset-preflight" ]'
    );
    expect(deployWorkflow).toContain(
      'ERROR: password reset reconciler preflight execution template mismatch'
    );
    expect(deployWorkflow).not.toContain('--args "npm" "run" "worker:password-reset-preflight"');
    expect(deployWorkflow).not.toContain('cat "$EXECUTION_TEMPLATE"');
    expect(
      deployWorkflow.indexOf('- name: Execute password reset reconciler preflight')
    ).toBeLessThan(deployWorkflow.indexOf('- name: Update Container App - Web'));
    expect(deployWorkflow).not.toContain('.checks.database.status');
    expect(deployWorkflow).not.toContain('.checks.cache.status');
  });

  it('uses one scale-aware worker readiness contract at every deployment boundary', () => {
    expect(deployWorkflow.match(/scripts\/worker-revision-ready\.sh/g)).toHaveLength(4);
    expect(deployWorkflow).toContain('.properties.healthState');
    expect(deployWorkflow).not.toContain('[ "$WORKER_RUNNING" = "Running" ]');
    expect(deployWorkflow).not.toContain('[ "$RECOVERY_WORKER_STATE" = "Running" ]');
  });

  it('uses idempotent activation and mode-correct traffic controls for web cutover', () => {
    const normalizationStart = deployWorkflow.indexOf(
      '- name: Normalize Web to captured stable revision'
    );
    const singleModeStart = deployWorkflow.indexOf('- name: Set Web to single-revision mode');
    const forwardJobStart = deployWorkflow.indexOf(
      '- name: Update Container App Job - Delayed Waker'
    );
    const recoveryStart = deployWorkflow.indexOf(
      '- name: Restore previous staging release after failure'
    );
    const recoveryWorkerStart = deployWorkflow.indexOf(
      '          if [ "$JOBS_MUTATED" = "true" ]; then',
      recoveryStart
    );

    for (const boundary of [
      normalizationStart,
      singleModeStart,
      forwardJobStart,
      recoveryStart,
      recoveryWorkerStart,
    ]) {
      expect(boundary).toBeGreaterThan(0);
    }

    const normalization = deployWorkflow.slice(normalizationStart, singleModeStart);
    const singleModeCutover = deployWorkflow.slice(singleModeStart, forwardJobStart);
    const recoveryWeb = deployWorkflow.slice(recoveryStart, recoveryWorkerStart);

    expect(normalization).toContain('--query properties.active');
    expect(normalization).toContain('if [ "${PREVIOUS_WEB_ACTIVE,,}" != "true" ]; then');
    expect(normalization).toContain('az containerapp revision activate \\');
    expect(normalization).toContain('az containerapp ingress traffic set \\');

    expect(recoveryWeb).toContain('--query properties.active');
    expect(recoveryWeb).toContain('RECOVERY_WEB_CAN_PROCEED=true');
    expect(recoveryWeb).toContain('if ! RECOVERY_PREVIOUS_WEB_ACTIVE=$(az');
    expect(recoveryWeb).toContain('elif [ "${RECOVERY_PREVIOUS_WEB_ACTIVE,,}" != "true" ] && \\');
    expect(recoveryWeb).toContain('az containerapp revision activate \\');
    expect(recoveryWeb).toContain('az containerapp ingress traffic set \\');
    expect(recoveryWeb).toContain('if ! RECOVERY_ACTIVE_REVISIONS=$(az');
    expect(recoveryWeb).toContain('done <<< "$RECOVERY_ACTIVE_REVISIONS"');
    expect(recoveryWeb.match(/RECOVERY_WEB_CAN_PROCEED=false/g)).toHaveLength(8);
    expect(recoveryWeb.match(/\[ "\$RECOVERY_WEB_CAN_PROCEED" = "true" \]/g)).toHaveLength(6);

    expect(singleModeCutover).not.toContain('az containerapp ingress traffic set');
    expect(recoveryWeb.slice(recoveryWeb.indexOf('--mode single'))).not.toContain(
      'az containerapp ingress traffic set'
    );
    expect(deployWorkflow.match(/az containerapp ingress traffic set \\/g)).toHaveLength(2);

    expect(deployWorkflow).toContain('post_deploy_gate=');
    expect(deployWorkflow).toContain('recovery_gate=');
    expect(
      deployWorkflow.match(/node scripts\/verify-password-reset-deployment-contract\.mjs/g)
    ).toHaveLength(3);
  });

  it('keeps reviewed migration startup controls on every documented deployment path', () => {
    const migrationPaths = [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy-staging.yml',
      '.github/workflows/standalone-validation.yml',
      'docker-entrypoint.sh',
      'docs/INSTALL.md',
      'DATABASE_SCHEMA.md',
      'DEPLOYMENT.md',
      'CLAUDE.md',
    ];
    for (const migrationPath of migrationPaths) {
      const source = readFileSync(`${repositoryRoot}/${migrationPath}`, 'utf8');
      expect(source).not.toContain('npx prisma migrate deploy');
    }
    expect(deployWorkflow).toContain('MIGRATION_DATABASE_URL: ${{ secrets.DATABASE_URL }}');
    expect(deployWorkflow).toContain('npm run db:migrate');
    const entrypoint = readFileSync(`${repositoryRoot}/docker-entrypoint.sh`, 'utf8');
    expect(entrypoint).not.toContain('db push --accept-data-loss');
    expect(entrypoint).toContain('PRISMA_FORCE_SCHEMA_SYNC is not permitted in production');
    expect(entrypoint).toContain('DATABASE_URL_ADMIN is required for production migrations');
  });

  it('documents that ordinary deployment cannot perform the first contract activation', () => {
    expect(rollout).toContain(
      'The ordinary staging deployment workflow cannot perform the first version 1 activation.'
    );
  });
});
