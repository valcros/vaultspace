/**
 * Backup archive encryption — authenticated envelope (AES-256-GCM).
 *
 * The backup archive is the ONLY at-rest encryption boundary for a tenant dump
 * that includes PII, password hashes, 2FA secrets, and per-document FileBlob
 * encryption keys. So encryption here must be real:
 *
 *  - a fresh random 256-bit Data Encryption Key (DEK) per archive;
 *  - each file encrypted with AES-256-GCM under the DEK with a UNIQUE 96-bit
 *    nonce and an auth tag (tamper-evident);
 *  - the DEK is WRAPPED with a Key Encryption Key (KEK) and stored in
 *    encryption.json — the plaintext DEK never touches disk;
 *  - the KEK comes from BACKUP_ENCRYPTION_KEY today. ⚠️ PROD HARDENING: wrap via
 *    KMS / Azure Key Vault instead of an env-held KEK, and store only a key id.
 *
 * ⚠️ This crypto path is NOT validated end-to-end here — verify a real
 * encrypt→decrypt round-trip of an archive before trusting it.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';

const ALG = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const ENCRYPTED_SUFFIX = '.enc';
const ENCRYPTION_MANIFEST = 'encryption.json';

export class BackupCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupCryptoError';
  }
}

function requireKek(): Buffer {
  const raw = process.env['BACKUP_ENCRYPTION_KEY'];
  if (!raw) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY is not set (32-byte base64 KEK required)');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

interface SealedBlob {
  nonce: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

function seal(key: Buffer, plaintext: Buffer): SealedBlob {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALG, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function open(key: Buffer, sealed: SealedBlob): Buffer {
  const decipher = createDecipheriv(ALG, key, Buffer.from(sealed.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

interface EncryptionManifest {
  alg: typeof ALG;
  keyId: string;
  wrappedDek: SealedBlob;
  files: string[]; // relative encrypted-file names (for restore integrity)
}

/**
 * Encrypt every file under `archiveDir` in place (foo → foo.enc), keyed by a
 * fresh DEK wrapped with the KEK. Writes ENCRYPTION_MANIFEST alongside.
 */
export async function encryptArchiveFile(archiveDir: string): Promise<void> {
  const kek = requireKek();
  const dek = randomBytes(KEY_BYTES);

  const files = walkFiles(archiveDir).filter(
    (f) => !f.endsWith(ENCRYPTED_SUFFIX) && !f.endsWith(ENCRYPTION_MANIFEST)
  );
  const encryptedRel: string[] = [];
  for (const file of files) {
    const sealed = seal(dek, readFileSync(file));
    const encPath = file + ENCRYPTED_SUFFIX;
    writeFileSync(encPath, JSON.stringify(sealed));
    unlinkSync(file);
    encryptedRel.push(encPath.slice(archiveDir.length + 1));
  }

  const manifest: EncryptionManifest = {
    alg: ALG,
    keyId: process.env['BACKUP_ENCRYPTION_KEY_ID'] ?? 'env-kek',
    wrappedDek: seal(kek, dek),
    files: encryptedRel,
  };
  writeFileSync(join(archiveDir, ENCRYPTION_MANIFEST), JSON.stringify(manifest, null, 2));
}

/** Decrypt every .enc file under `archiveDir` in place (reverse of encrypt). */
export async function decryptArchive(archiveDir: string): Promise<void> {
  const kek = requireKek();
  const manifestPath = join(archiveDir, ENCRYPTION_MANIFEST);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as EncryptionManifest;
  if (manifest.alg !== ALG) {
    throw new BackupCryptoError(`Unsupported archive alg: ${manifest.alg}`);
  }
  const dek = open(kek, manifest.wrappedDek);

  const root = resolve(archiveDir);
  for (const rel of manifest.files) {
    // Reject path traversal: a tampered manifest must not write outside the archive.
    const encPath = resolve(archiveDir, rel);
    if (!encPath.startsWith(root + sep) && encPath !== root) {
      throw new BackupCryptoError(`Refusing manifest path outside the archive: ${rel}`);
    }
    const sealed = JSON.parse(readFileSync(encPath, 'utf8')) as SealedBlob;
    const plaintext = open(dek, sealed); // throws on tamper (bad auth tag)
    const outPath = encPath.slice(0, -ENCRYPTED_SUFFIX.length);
    writeFileSync(outPath, plaintext);
  }
}

/** Exposed for unit testing the seal/open round-trip without filesystem. */
export const __test__ = { seal, open, requireKek };
