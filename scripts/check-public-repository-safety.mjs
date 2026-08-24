#!/usr/bin/env node

/**
 * Guardrail for content that does not belong in VaultSpace's public repository.
 *
 * The scanner deliberately reports only a file, line number, and rule identifier.
 * It never echoes a potentially sensitive match into a CI log. It complements,
 * rather than replaces, credential scanning and the restricted remediation scan.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const prohibitedPathRules = [
  { rule: 'restricted-operator-notes', expression: /^\.dev-notes\// },
  { rule: 'restricted-audit-evidence', expression: /^docs\/audit\// },
  { rule: 'generated-temporary-output', expression: /^tmp\// },
];

const contentRules = [
  { rule: 'private-key-material', expression: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/gi },
  {
    rule: 'azure-resource-id',
    expression: /\/subscriptions\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?:\/|$)/gi,
  },
  {
    rule: 'cloud-connection-string',
    expression: /DefaultEndpointsProtocol=https;AccountName=[^;\s]+;AccountKey=[^;\s]+/gi,
  },
  { rule: 'signed-access-url', expression: /[?&]sig=[^\s&]+/gi },
  {
    rule: 'concrete-azure-resource-name',
    expression:
      /(?:^|[^a-z0-9])(?:ca|psql|aoai|vm|kv|rg)-vaultspace(?:-[a-z0-9]+)+(?![a-z0-9-])/gim,
  },
  {
    rule: 'concrete-cloud-endpoint',
    expression:
      /\b(?!(?:example|localhost)\.)[a-z0-9-]+\.(?:azurecr\.io|postgres\.database\.azure\.com)/gi,
  },
];

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  if (a >= 224) return false;
  return true;
}

const findings = [];
for (const file of trackedFiles) {
  // A local remediation worktree can contain tracked files that have been moved
  // out of the public tree but not yet committed. The committed checkout used by
  // CI cannot have this condition. Skip only the absent working-tree file here.
  if (!existsSync(file)) continue;

  for (const { rule, expression } of prohibitedPathRules) {
    if (expression.test(file)) findings.push({ file, line: 1, rule });
  }

  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  const isSyntheticTest = /(?:^|\/)[\w-]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

  if (!isSyntheticTest) {
    for (const { rule, expression } of contentRules) {
      expression.lastIndex = 0;
      for (let match = expression.exec(text); match; match = expression.exec(text)) {
        findings.push({ file, line: lineNumber(text, match.index), rule });
      }
    }

    const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    for (let match = ipv4.exec(text); match; match = ipv4.exec(text)) {
      if (isPublicIpv4(match[0])) {
        findings.push({ file, line: lineNumber(text, match.index), rule: 'public-ip-address' });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Public repository safety check failed. Findings are redacted.');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.rule}`);
  }
  process.exit(1);
}

console.log(`Public repository safety check passed for ${trackedFiles.length} tracked files.`);
