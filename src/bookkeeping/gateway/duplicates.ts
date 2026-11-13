import path from 'path';
import type { StatementRow } from './types.js';
import { loadFingerprints } from './fingerprint.js';
import { GatewayPaths, loadStatementRows } from './store.js';

export interface DuplicateReport {
  duplicateFiles: Array<{ path: string; sha256: string; duplicateOf: string }>;
  duplicateRows: Array<{ rowId: string; otherRowId: string; reason: string }>;
}

function rowSignature(row: StatementRow): string {
  return [
    row.txnDate ?? '',
    row.amount == null ? '' : row.amount.toFixed(2),
    row.description.trim().toLowerCase(),
  ].join('|');
}

/**
 * Detect duplicate files (by fingerprint) and duplicate statement rows (date+amount+description).
 */
export function detectDuplicates(paths: GatewayPaths): DuplicateReport {
  const fingerprints = loadFingerprints(paths.fingerprintStorePath);
  const duplicateFiles = fingerprints
    .filter((f) => f.duplicateOf)
    .map((f) => ({
      path: path.basename(f.path),
      sha256: f.sha256.slice(0, 12),
      duplicateOf: path.basename(f.duplicateOf as string),
    }));

  const rows = loadStatementRows(paths.statementsPath);
  const seen = new Map<string, string>();
  const duplicateRows: DuplicateReport['duplicateRows'] = [];
  for (const row of rows) {
    const sig = rowSignature(row);
    const prior = seen.get(sig);
    if (prior) {
      duplicateRows.push({
        rowId: row.rowId,
        otherRowId: prior,
        reason: 'Same date + amount + description',
      });
    } else {
      seen.set(sig, row.rowId);
    }
  }

  return { duplicateFiles, duplicateRows };
}
