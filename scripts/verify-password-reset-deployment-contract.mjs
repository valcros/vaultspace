#!/usr/bin/env node

const CONTRACT_LABEL = 'org.vaultspace.password-reset-delivery-contract-version';
const REVISION_LABEL = 'org.opencontainers.image.revision';
const FULL_GIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(message);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function imageRepository(reference) {
  const digestIndex = reference.indexOf('@');
  if (digestIndex >= 0) {
    return reference.slice(0, digestIndex);
  }
  const slashIndex = reference.lastIndexOf('/');
  const colonIndex = reference.lastIndexOf(':');
  return colonIndex > slashIndex ? reference.slice(0, colonIndex) : reference;
}

function imageTag(reference) {
  if (reference.includes('@')) {
    return null;
  }
  const slashIndex = reference.lastIndexOf('/');
  const colonIndex = reference.lastIndexOf(':');
  return colonIndex > slashIndex ? reference.slice(colonIndex + 1) : null;
}

function validateImage(name, value, expectedRevision = null) {
  const image = requireObject(value, name);
  if (typeof image.reference !== 'string' || image.reference.length === 0) {
    fail(`${name} reference is required`);
  }
  if (typeof image.digest !== 'string' || !IMAGE_DIGEST.test(image.digest)) {
    fail(`${name} digest must be an unambiguous sha256 digest`);
  }
  const runnableDigest = image.runnableDigest ?? image.digest;
  if (typeof runnableDigest !== 'string' || !IMAGE_DIGEST.test(runnableDigest)) {
    fail(`${name} runnable digest must be an unambiguous sha256 digest`);
  }
  const labels = requireObject(image.labels, `${name} labels`);
  if (labels[CONTRACT_LABEL] !== '1') {
    fail(`${name} does not declare password reset delivery contract version 1`);
  }
  const revision = labels[REVISION_LABEL];
  if (typeof revision !== 'string' || !FULL_GIT_SHA.test(revision)) {
    fail(`${name} does not declare a full Git source revision`);
  }
  if (expectedRevision !== null && revision !== expectedRevision) {
    fail(`${name} source revision does not match the expected deployment revision`);
  }

  const tag = imageTag(image.reference);
  if (tag !== null && tag !== revision) {
    fail(`${name} tag is not bound to its declared source revision`);
  }
  if (image.reference.includes('@') && !image.reference.endsWith(`@${image.digest}`)) {
    fail(`${name} digest reference does not match the inspected manifest`);
  }

  return {
    revision,
    pinnedReference: `${imageRepository(image.reference)}@${runnableDigest}`,
  };
}

function resolveTrafficRevision(entry, latestRevisionName) {
  if (typeof entry.revisionName === 'string' && entry.revisionName.length > 0) {
    return entry.revisionName;
  }
  if (entry.latestRevision === true && typeof latestRevisionName === 'string') {
    return latestRevisionName;
  }
  return null;
}

function validateWebConvergence(value) {
  const convergence = requireObject(value, 'web convergence');
  for (const field of ['revision', 'image', 'expectedImage', 'expectedRelease']) {
    if (typeof convergence[field] !== 'string' || convergence[field].length === 0) {
      fail(`web convergence ${field} is required`);
    }
  }
  if (convergence.image !== convergence.expectedImage) {
    fail('web convergence image does not match the verified image');
  }
  if (
    !Array.isArray(convergence.activeWebRevisions) ||
    convergence.activeWebRevisions.length !== 1 ||
    convergence.activeWebRevisions[0] !== convergence.revision
  ) {
    fail('the verified web revision must be the sole active revision');
  }
  if (!Array.isArray(convergence.traffic)) {
    fail('web convergence traffic must be an array');
  }
  const positiveTraffic = convergence.traffic.filter(
    (entry) => entry && typeof entry.weight === 'number' && entry.weight > 0
  );
  if (positiveTraffic.length !== 1 || positiveTraffic[0].weight !== 100) {
    fail('the verified web revision must receive all positive traffic');
  }
  if (
    resolveTrafficRevision(positiveTraffic[0], convergence.latestRevisionName) !==
    convergence.revision
  ) {
    fail('public traffic does not resolve to the verified web revision');
  }
  if (
    typeof convergence.cacheControl !== 'string' ||
    !/(^|,)\s*no-store\s*(,|$)/i.test(convergence.cacheControl)
  ) {
    fail('converged health response must declare Cache-Control no-store');
  }
  const healthBody = requireObject(convergence.healthBody, 'converged health body');
  const recovery = requireObject(
    healthBody.passwordResetRecovery,
    'converged health recovery capability'
  );
  if (
    typeof recovery.deliveryContractVersion !== 'number' ||
    recovery.deliveryContractVersion !== 1
  ) {
    fail('converged health delivery contract version must be numeric 1');
  }
  if (healthBody.revision !== convergence.revision) {
    fail('converged health revision does not match the verified Azure revision');
  }
  if (healthBody.release !== convergence.expectedRelease) {
    fail('converged health release does not match the expected source revision');
  }

  return { VERIFIED_WEB_REVISION: convergence.revision };
}

function validateInput(input) {
  const root = requireObject(input, 'verification input');
  if (root.convergence !== undefined) {
    return validateWebConvergence(root.convergence);
  }
  const target = requireObject(root.target, 'target');
  if (typeof target.expectedRevision !== 'string' || !FULL_GIT_SHA.test(target.expectedRevision)) {
    fail('target expectedRevision must be a full Git SHA');
  }
  const targetWeb = validateImage('target web image', target.web, target.expectedRevision);
  const targetWorker = validateImage('target worker image', target.worker, target.expectedRevision);

  const rollback = requireObject(root.rollback, 'rollback');
  const rollbackWeb = validateImage('rollback web image', rollback.web);
  const rollbackWorker = validateImage('rollback worker image', rollback.worker);
  let rollbackReconciler = null;
  if (rollback.reconciler !== null && rollback.reconciler !== undefined) {
    rollbackReconciler = validateImage('rollback reset reconciler image', rollback.reconciler);
  }
  if (rollbackWorker.revision !== rollbackWeb.revision) {
    fail('rollback web and worker images do not declare the same source revision');
  }
  if (rollbackReconciler && rollbackReconciler.revision !== rollbackWeb.revision) {
    fail('rollback reset reconciler does not match the rollback web source revision');
  }

  const serving = requireObject(root.serving, 'serving');
  if (
    !Array.isArray(serving.activeWebRevisions) ||
    serving.activeWebRevisions.length !== 1 ||
    serving.activeWebRevisions[0] !== serving.capturedRevision
  ) {
    fail('exactly one captured web revision must be active');
  }
  if (serving.currentRevisionImage !== serving.capturedImage) {
    fail('the active web revision image changed after before-state capture');
  }
  if (serving.capturedImage !== rollback.web.reference) {
    fail('rollback web metadata is not bound to the captured web image');
  }
  if (!Array.isArray(serving.traffic)) {
    fail('serving traffic must be an array');
  }
  const positiveTraffic = serving.traffic.filter(
    (entry) => entry && typeof entry.weight === 'number' && entry.weight > 0
  );
  if (positiveTraffic.length !== 1 || positiveTraffic[0].weight !== 100) {
    fail('exactly one web revision must receive 100 percent of positive traffic');
  }
  if (
    resolveTrafficRevision(positiveTraffic[0], serving.latestRevisionName) !==
    serving.capturedRevision
  ) {
    fail('public traffic is not bound to the captured web revision');
  }

  const health = requireObject(root.health, 'health');
  if (
    typeof health.cacheControl !== 'string' ||
    !/(^|,)\s*no-store\s*(,|$)/i.test(health.cacheControl)
  ) {
    fail('health response must declare Cache-Control no-store');
  }
  const healthBody = requireObject(health.body, 'health body');
  const recovery = requireObject(healthBody.passwordResetRecovery, 'health recovery capability');
  if (
    typeof recovery.deliveryContractVersion !== 'number' ||
    recovery.deliveryContractVersion !== 1
  ) {
    fail('health delivery contract version must be numeric 1');
  }
  if (healthBody.revision !== serving.capturedRevision) {
    fail('health revision does not match the captured Azure revision');
  }
  if (healthBody.release !== rollbackWeb.revision) {
    fail('health release does not match the rollback image source revision');
  }

  return {
    TARGET_WEB_IMAGE_PINNED: targetWeb.pinnedReference,
    TARGET_WORKER_IMAGE_PINNED: targetWorker.pinnedReference,
    PREVIOUS_WEB_IMAGE_PINNED: rollbackWeb.pinnedReference,
    PREVIOUS_WORKER_IMAGE_PINNED: rollbackWorker.pinnedReference,
    PREVIOUS_RESET_RECONCILER_IMAGE_PINNED: rollbackReconciler?.pinnedReference ?? '',
    PREVIOUS_WEB_RELEASE: rollbackWeb.revision,
    VERIFIED_PASSWORD_RESET_CONTRACT_VERSION: '1',
  };
}

let rawInput = '';
for await (const chunk of process.stdin) {
  rawInput += chunk;
}

try {
  const parsed = JSON.parse(rawInput);
  process.stdout.write(`${JSON.stringify(validateInput(parsed))}\n`);
} catch (error) {
  const message =
    error instanceof SyntaxError ? 'verification input is not valid JSON' : error.message;
  process.stderr.write(
    `ERROR: password reset deployment contract verification failed: ${message}\n`
  );
  process.exitCode = 1;
}
