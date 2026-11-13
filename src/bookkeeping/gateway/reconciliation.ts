import fs from 'fs';
import path from 'path';
import type { ReconciliationStatus } from './types.js';
import { formatControlRecordMarkdown, loadControlRecord } from './control-record.js';
import { loadFingerprints } from './fingerprint.js';
import { GatewayPaths, loadOwnerAnswers, loadStatementRows } from './store.js';

export function reconciliationStatus(paths: GatewayPaths): ReconciliationStatus & { markdown: string } {
  const control = loadControlRecord(paths.controlRecordPath);
  const rows = loadStatementRows(paths.statementsPath);
  const byMatchStatus: Record<string, number> = {};
  for (const row of rows) {
    byMatchStatus[row.matchStatus] = (byMatchStatus[row.matchStatus] ?? 0) + 1;
  }
  const batchCount = fs.existsSync(paths.batchesDir)
    ? fs.readdirSync(paths.batchesDir).filter((f) => f.endsWith('.json')).length
    : 0;

  const status: ReconciliationStatus = {
    control,
    fingerprints: loadFingerprints(paths.fingerprintStorePath).length,
    statementRows: rows.length,
    byMatchStatus,
    ownerAnswers: loadOwnerAnswers(paths.ownerAnswersPath).length,
    approvalBatches: batchCount,
    applyApprovedBatchAvailable: false,
  };

  return {
    ...status,
    markdown: formatControlRecordMarkdown(control),
  };
}

export function listApprovalBatchFiles(paths: GatewayPaths): string[] {
  if (!fs.existsSync(paths.batchesDir)) return [];
  return fs.readdirSync(paths.batchesDir).filter((f) => f.endsWith('.json')).map((f) => path.join(paths.batchesDir, f));
}
