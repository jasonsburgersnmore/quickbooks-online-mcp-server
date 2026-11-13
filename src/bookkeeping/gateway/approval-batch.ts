import fs from 'fs';
import path from 'path';
import { appendGatewayAudit } from './audit-log-file.js';
import { GatewayPaths, loadStatementRows } from './store.js';

export interface ApprovalBatchSummary {
  batchId: string;
  createdAt: string;
  itemCount: number;
  status: 'AwaitingOwnerApproval';
  applyApprovedBatchAvailable: false;
  filePath: string;
}

/**
 * Build a local approval batch proposal. Does NOT apply to QuickBooks.
 * Explicitly does not implement apply_approved_batch.
 */
export function buildApprovalBatch(paths: GatewayPaths, batchId?: string): ApprovalBatchSummary {
  const id = batchId ?? `batch-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const rows = loadStatementRows(paths.statementsPath).filter(
    (r) => r.matchStatus === 'Possible' && r.proposedCategory,
  );
  const createdAt = new Date().toISOString();
  const payload = {
    batchId: id,
    createdAt,
    environment: 'sandbox',
    status: 'AwaitingOwnerApproval',
    applyStatus: 'NOT_APPLIED',
    applyApprovedBatchAvailable: false as const,
    criticalStop: 'apply_approved_batch is not implemented; do not post to QuickBooks',
    items: rows.map((r) => ({
      rowId: r.rowId,
      txnDate: r.txnDate,
      amount: r.amount,
      description: r.description,
      proposedCategory: r.proposedCategory,
      matchStatus: r.matchStatus,
      matchedQboId: r.matchedQboId,
    })),
  };

  fs.mkdirSync(paths.batchesDir, { recursive: true });
  const filePath = path.join(paths.batchesDir, `${id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  appendGatewayAudit(paths.auditLogPath, {
    action: 'build_approval_batch',
    summary: `Built local approval batch ${id}`,
    details: { batchId: id, itemCount: rows.length, applyApprovedBatchAvailable: false },
  });

  return {
    batchId: id,
    createdAt,
    itemCount: rows.length,
    status: 'AwaitingOwnerApproval',
    applyApprovedBatchAvailable: false,
    filePath,
  };
}
