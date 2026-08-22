import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const verifierPath = `${repositoryRoot}/scripts/verify-password-reset-deployment-contract.mjs`;
const workerRevisionReadyPath = `${repositoryRoot}/scripts/worker-revision-ready.sh`;
const containerEnvValidatorPath = `${repositoryRoot}/scripts/validate-container-env.sh`;
const targetRevision = 'a'.repeat(40);
const rollbackRevision = 'b'.repeat(40);
const rollbackConsumerRevision = 'c'.repeat(40);

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
        passwordResetTokens: { writeMode: 'hmac' },
        passwordResetRecovery: { configured: true, deliveryContractVersion: 1 },
      },
    },
  };
}

function splitRollbackConsumerSources(input: ReturnType<typeof validInput>) {
  input.rollback.worker = image('vaultspace-worker', rollbackConsumerRevision, '4');
  input.rollback.reconciler = image('vaultspace-worker', rollbackConsumerRevision, '5');
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

type ContainerEnvironmentEntry = {
  name: string;
  secretRef?: string;
  value?: string;
};

type WorkloadSecretMetadata = {
  name: string;
  keyVaultUrl?: string;
  identity?: string;
};

type WorkloadMetadata = {
  properties: {
    template: { containers: [{ name: string; env: ContainerEnvironmentEntry[] }] };
    configuration: { secrets: WorkloadSecretMetadata[] };
  };
};

type SyntheticWorkloads = {
  'synthetic-web': WorkloadMetadata;
  'synthetic-worker': WorkloadMetadata;
  'synthetic-waker': WorkloadMetadata;
  'synthetic-lifecycle': WorkloadMetadata;
  'synthetic-reconciler': WorkloadMetadata;
};

function workloadMetadata(
  containerName: string,
  env: ContainerEnvironmentEntry[]
): WorkloadMetadata {
  return {
    properties: {
      template: { containers: [{ name: containerName, env }] },
      configuration: {
        secrets: env.flatMap((entry) =>
          entry.secretRef
            ? [
                {
                  name: entry.secretRef,
                  keyVaultUrl: `https://synthetic-vault.vault.azure.net/secrets/${entry.secretRef}`,
                  identity: 'system',
                },
              ]
            : []
        ),
      },
    },
  };
}

function validateContainerEnv(
  workerImage: string,
  mutateWorkloads?: (workloads: SyntheticWorkloads) => void
) {
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
    'PASSWORD_RESET_RECOVERY_KEYS',
  ]);
  const envEntry = (name: string): ContainerEnvironmentEntry =>
    secretNames.has(name)
      ? { name, secretRef: `synthetic-${name.toLowerCase().replaceAll('_', '-')}` }
      : { name, value: `synthetic-${name.toLowerCase()}` };
  const webEnv = [...sharedNames, 'DATABASE_URL_ADMIN'].map(envEntry);
  const workerEnv = [...sharedNames, 'WORKER_TYPE'].map(envEntry);
  const wakerEnv = [envEntry('REDIS_URL')];
  const lifecycleEnv = [
    envEntry('DATABASE_URL'),
    envEntry('DATABASE_URL_ADMIN'),
    envEntry('ACS_CONNECTION_STRING'),
  ];
  const reconcilerEnv = [
    envEntry('DATABASE_URL'),
    envEntry('REDIS_URL'),
    envEntry('SESSION_SECRET'),
    envEntry('PASSWORD_RESET_RECOVERY_KEYS'),
    envEntry('PASSWORD_RESET_RECONCILER_ENABLED'),
  ];
  const workloads: SyntheticWorkloads = {
    'synthetic-web': workloadMetadata('synthetic-web', webEnv),
    'synthetic-worker': workloadMetadata('synthetic-worker', workerEnv),
    'synthetic-waker': workloadMetadata('synthetic-waker', wakerEnv),
    'synthetic-lifecycle': workloadMetadata('synthetic-lifecycle', lifecycleEnv),
    'synthetic-reconciler': workloadMetadata('synthetic-reconciler', reconcilerEnv),
  };
  mutateWorkloads?.(workloads);
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
  elif [[ "$query" == *".env"* ]]; then
    echo "$MOCK_WORKLOADS" | jq -c --arg app "$app" '.[$app].properties.template.containers[0].env'
  elif [ -z "$query" ]; then
    echo "$MOCK_WORKLOADS" | jq -c --arg app "$app" '.[$app]'
  else
    printf '%s\n' 'null'
  fi
}
export -f az
"$1" synthetic-rg synthetic-web synthetic-web synthetic-worker synthetic-worker synthetic-waker synthetic-waker synthetic-lifecycle synthetic-reconciler
`;

  return spawnSync(
    'bash',
    ['-c', controlledAzure, 'container-env-direct-test', containerEnvValidatorPath],
    {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env['PATH'] ?? '',
        MOCK_WORKLOADS: JSON.stringify(workloads),
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

  it('accepts independently sourced contract-v1 consumers in proven HMAC steady state', () => {
    const input = validInput();
    splitRollbackConsumerSources(input);

    const result = verify(input);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      PREVIOUS_WEB_RELEASE: rollbackRevision,
      PREVIOUS_WORKER_IMAGE_PINNED: `registry.example.com/vaultspace-worker@sha256:${'4'.repeat(64)}`,
      PREVIOUS_RESET_RECONCILER_IMAGE_PINNED: `registry.example.com/vaultspace-worker@sha256:${'5'.repeat(64)}`,
    });
  });

  it.each([
    ['legacy write mode', 'legacy', true],
    ['unconfigured recovery', 'hmac', false],
  ])(
    'keeps the same-source first-activation guard strict for %s',
    (_name, writeMode, configured) => {
      const input = validInput();
      splitRollbackConsumerSources(input);
      input.health.body.passwordResetTokens.writeMode = writeMode;
      input.health.body.passwordResetRecovery.configured = configured;

      const result = verify(input);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('first activation requires rollback web and worker');
    }
  );

  it('keeps the same-source guard strict when token mode evidence is missing', () => {
    const input = validInput();
    splitRollbackConsumerSources(input);
    delete (input.health.body as { passwordResetTokens?: unknown }).passwordResetTokens;

    const result = verify(input);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('first activation requires rollback web and worker');
  });

  it('does not coerce string-valued recovery configuration into steady state', () => {
    const input = validInput();
    splitRollbackConsumerSources(input);
    Object.assign(input.health.body.passwordResetRecovery, { configured: 'true' });

    const result = verify(input);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('first activation requires rollback web and worker');
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
      'rollback worker tag and source label mismatch',
      (input: ReturnType<typeof validInput>) => {
        input.rollback.worker.labels['org.opencontainers.image.revision'] = targetRevision;
      },
    ],
    [
      'rollback reconciler missing its contract label',
      (input: ReturnType<typeof validInput>) => {
        delete (input.rollback.reconciler!.labels as Record<string, string>)[
          'org.vaultspace.password-reset-delivery-contract-version'
        ];
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
      `<azure-container-registry>/vaultspace-worker:${targetRevision}`,
    ],
    [
      'a digest-pinned ACR reference',
      `<azure-container-registry>/vaultspace-worker@sha256:${'1'.repeat(64)}`,
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
    `<azure-container-registry>/vaultspace-web@sha256:${'2'.repeat(64)}`,
    `<azure-container-registry>/team/vaultspace-worker-lookalike:${targetRevision}`,
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
      `<azure-container-registry>/vaultspace-worker@sha256:${'3'.repeat(64)}`
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: image repo is vaultspace-worker');
    expect(result.stdout).toContain('Validation passed');
  });

  it('rejects a different repository through direct validator execution', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-web@sha256:${'4'.repeat(64)}`
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("repo 'vaultspace-web'");
    expect(result.stdout).toContain("expected the 'vaultspace-worker' image");
    expect(result.stdout).toContain('Validation failed: 1 error(s) found');
  });

  it('rejects a sensitive Container App secretRef that is not backed by Key Vault', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'5'.repeat(64)}`,
      (workloads) => {
        const workerSecrets = workloads['synthetic-worker'].properties.configuration.secrets;
        const acsSecret = workerSecrets.find(
          (secret) => secret.name === 'synthetic-acs-connection-string'
        );
        if (!acsSecret) {
          throw new Error('Synthetic ACS secret fixture is missing');
        }
        delete acsSecret.keyVaultUrl;
        delete acsSecret.identity;
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'ERROR: synthetic-worker ACS_CONNECTION_STRING must resolve through an Azure Key Vault secret'
    );
    expect(result.stdout).not.toContain('not-displayed');
  });

  it('rejects a Key Vault reference without a managed identity', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'a'.repeat(64)}`,
      (workloads) => {
        const wakerSecrets = workloads['synthetic-waker'].properties.configuration.secrets;
        const redisSecret = wakerSecrets.find((secret) => secret.name === 'synthetic-redis-secret');
        if (!redisSecret) {
          throw new Error('Synthetic Redis secret fixture is missing');
        }
        delete redisSecret.identity;
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'ERROR: synthetic-waker REDIS_URL Key Vault reference must use a managed identity'
    );
  });

  it('rejects a literal value for a sensitive Container App setting without printing it', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'6'.repeat(64)}`,
      (workloads) => {
        const session = workloads['synthetic-web'].properties.template.containers[0].env.find(
          (entry) => entry.name === 'SESSION_SECRET'
        );
        if (!session) {
          throw new Error('Synthetic session secret fixture is missing');
        }
        delete session.secretRef;
        session.value = 'not-displayed';
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ERROR: synthetic-web SESSION_SECRET must use a secretRef');
    expect(result.stdout).not.toContain('not-displayed');
  });

  it('rejects a sensitive setting that mixes a secretRef with a literal value', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'9'.repeat(64)}`,
      (workloads) => {
        const redis = workloads['synthetic-worker'].properties.template.containers[0].env.find(
          (entry) => entry.name === 'REDIS_URL'
        );
        if (!redis) {
          throw new Error('Synthetic Redis secret fixture is missing');
        }
        redis.value = 'not-displayed';
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'ERROR: synthetic-worker REDIS_URL must not include a literal value'
    );
    expect(result.stdout).not.toContain('not-displayed');
  });

  it('validates required Key Vault bindings on scheduled jobs', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'7'.repeat(64)}`,
      (workloads) => {
        const lifecycle = workloads['synthetic-lifecycle'];
        lifecycle.properties.template.containers[0].env =
          lifecycle.properties.template.containers[0].env.filter(
            (entry) => entry.name !== 'ACS_CONNECTION_STRING'
          );
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'ERROR: synthetic-lifecycle missing required env var: ACS_CONNECTION_STRING'
    );
  });

  it('rejects the worker legacy Redis password credential path', () => {
    const result = validateContainerEnv(
      `<azure-container-registry>/vaultspace-worker@sha256:${'8'.repeat(64)}`,
      (workloads) => {
        workloads['synthetic-worker'].properties.template.containers[0].env.push({
          name: 'REDIS_PASSWORD',
          secretRef: 'synthetic-legacy-redis-password',
        });
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      'ERROR: synthetic-worker has forbidden runtime env var: REDIS_PASSWORD'
    );
  });
});

describe('staging deployment workflow boundary', () => {
  const deployWorkflow = readFileSync(
    `${repositoryRoot}/.github/workflows/deploy-staging.yml`,
    'utf8'
  );
  const ciWorkflow = readFileSync(`${repositoryRoot}/.github/workflows/ci.yml`, 'utf8');
  const webConvergenceHelper = readFileSync(
    `${repositoryRoot}/scripts/wait-for-web-convergence.sh`,
    'utf8'
  );
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
    ).toHaveLength(2);
    expect(webConvergenceHelper).toContain(
      'node scripts/verify-password-reset-deployment-contract.mjs'
    );
    expect(webConvergenceHelper).toContain('post_deploy_gate=');
    expect(deployWorkflow).toContain('recovery_gate=');
    expect(deployWorkflow).toContain('RECOVERY_ACTIVE_WEB_REVISIONS');
  });

  it('uses quick production health and validates the real reset reconciler job', () => {
    expect(deployWorkflow).not.toContain('deep=true');
    expect(webConvergenceHelper).not.toContain('deep=true');
    expect(deployWorkflow).toContain(
      'api/health?deployment_gate=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${ATTEMPT}'
    );
    expect(deployWorkflow).toContain(
      'api/health?recovery_gate=${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${ATTEMPT}'
    );
    expect(deployWorkflow.match(/-H "Cache-Control: no-cache"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(deployWorkflow.match(/-H "Pragma: no-cache"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(webConvergenceHelper).toContain('-H "Cache-Control: no-cache"');
    expect(webConvergenceHelper).toContain('-H "Pragma: no-cache"');
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

  it('runs the unified Key Vault reference audit across every deployed workload', () => {
    expect(deployWorkflow).toContain(
      '- name: Validate Container Apps and Key Vault secret references'
    );
    expect(deployWorkflow).toContain('"$WAKER_JOB_APP"');
    expect(deployWorkflow).toContain('"$LIFECYCLE_JOB_APP"');
    expect(deployWorkflow).toContain('"$RESET_RECONCILER_JOB_APP"');
    expect(deployWorkflow).toContain('scripts/validate-container-env.sh');
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

    expect(webConvergenceHelper).toContain('post_deploy_gate=');
    expect(deployWorkflow).toContain('recovery_gate=');
    expect(
      deployWorkflow.match(/node scripts\/verify-password-reset-deployment-contract\.mjs/g)
    ).toHaveLength(2);
    expect(webConvergenceHelper).toContain(
      'node scripts/verify-password-reset-deployment-contract.mjs'
    );
  });

  it('bounds forward web convergence while preserving fresh strict evidence on every attempt', () => {
    expect(deployWorkflow).toContain('timeout --signal=TERM --kill-after=5s 240s');
    expect(deployWorkflow).toContain("WEB_CONVERGENCE_TIMEOUT_SECONDS: '210'");
    expect(deployWorkflow).toContain('scripts/wait-for-web-convergence.sh');
    expect(webConvergenceHelper).toContain('for ((ATTEMPT = 1;');
    expect(webConvergenceHelper).toContain('properties.latestRevisionName');
    expect(webConvergenceHelper).toContain('az containerapp revision show');
    expect(webConvergenceHelper).toContain("--query '[?properties.active].name'");
    expect(webConvergenceHelper).toContain('az containerapp ingress traffic show');
    expect(webConvergenceHelper).toContain('curl -fsS --max-time 15');
    expect(webConvergenceHelper).toContain('[ "$health_status" != "healthy" ]');
    expect(webConvergenceHelper).toContain('--arg expectedImage "$TARGET_WEB_IMAGE_PINNED"');
    expect(webConvergenceHelper).toContain('--arg expectedRelease "$DEPLOY_SHA"');
    expect(webConvergenceHelper).toContain('--argjson activeWebRevisions');
    expect(webConvergenceHelper).toContain('--argjson traffic');
    expect(webConvergenceHelper).toContain('--arg cacheControl');
    expect(webConvergenceHelper).toContain('--argjson healthBody');
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
    expect(deployWorkflow).toContain(
      'MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}'
    );
    expect(deployWorkflow).not.toContain('MIGRATION_DATABASE_URL: ${{ secrets.DATABASE_URL }}');
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
