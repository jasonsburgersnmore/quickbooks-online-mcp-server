import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { FileFingerprint } from './types.js';

export function sha256File(filePath: string): { sha256: string; byteLength: number } {
  const buf = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    byteLength: buf.byteLength,
  };
}

export function defaultFingerprintStorePath(rootDir: string): string {
  return path.join(rootDir, 'data', 'local', 'file-fingerprints.json');
}

export function loadFingerprints(storePath: string): FileFingerprint[] {
  if (!fs.existsSync(storePath)) return [];
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8')) as FileFingerprint[];
  return Array.isArray(raw) ? raw : [];
}

export function saveFingerprints(storePath: string, items: FileFingerprint[]): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

/**
 * Fingerprint a file before ingest. Returns duplicateOf when SHA-256 already seen
 * (including a prior ingest of the same path).
 */
export function fingerprintFile(
  filePath: string,
  storePath: string,
  nowIso: string = new Date().toISOString(),
): FileFingerprint {
  const abs = path.resolve(filePath);
  const { sha256, byteLength } = sha256File(abs);
  const existing = loadFingerprints(storePath);
  const priorSameHash = existing.find((f) => f.sha256 === sha256);
  const entry: FileFingerprint = {
    path: abs,
    sha256,
    byteLength,
    ingestedAt: priorSameHash?.ingestedAt ?? null,
    duplicateOf: priorSameHash
      ? path.resolve(priorSameHash.path) === abs
        ? abs
        : priorSameHash.path
      : null,
  };
  // Keep a single row per path; also keep other paths so cross-file duplicates stay visible.
  const withoutSamePath = existing.filter((f) => path.resolve(f.path) !== abs);
  if (!priorSameHash || path.resolve(priorSameHash.path) === abs) {
    withoutSamePath.push({
      ...entry,
      // On first sighting, clear duplicateOf so ingest can proceed.
      duplicateOf: priorSameHash && priorSameHash.ingestedAt ? entry.duplicateOf : null,
      ingestedAt: priorSameHash?.ingestedAt ?? null,
    });
  } else {
    withoutSamePath.push(entry);
  }
  saveFingerprints(storePath, withoutSamePath);
  void nowIso;

  const saved = loadFingerprints(storePath).find((f) => path.resolve(f.path) === abs)!;
  // Block re-ingest when this hash was already ingested (same or different path).
  if (priorSameHash?.ingestedAt) {
    return {
      ...saved,
      duplicateOf: path.resolve(priorSameHash.path) === abs ? abs : priorSameHash.path,
    };
  }
  return saved;
}

export function markFingerprintIngested(storePath: string, sha256: string): void {
  const items = loadFingerprints(storePath);
  const next = items.map((f) =>
    f.sha256 === sha256 ? { ...f, ingestedAt: new Date().toISOString() } : f,
  );
  saveFingerprints(storePath, next);
}
