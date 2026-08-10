import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const verifierPath = `${repositoryRoot}/scripts/verify-password-reset-deployment-contract.mjs`;
const workerRevisionReadyPath = `${repositoryRoot}/scripts/worker-revision-ready.sh`;
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

  it('uses one scale-aware worker readiness contract at every deployment boundary', () => {
    expect(deployWorkflow.match(/scripts\/worker-revision-ready\.sh/g)).toHaveLength(4);
    expect(deployWorkflow).toContain('.properties.healthState');
    expect(deployWorkflow).not.toContain('[ "$WORKER_RUNNING" = "Running" ]');
    expect(deployWorkflow).not.toContain('[ "$RECOVERY_WORKER_STATE" = "Running" ]');
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
