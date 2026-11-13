import type { MatchStatus, StatementRow } from './types.js';
import { appendGatewayAudit } from './audit-log-file.js';
import {
  GatewayPaths,
  loadStatementRows,
  refreshControlCountsFromLocal,
  saveStatementRows,
} from './store.js';

/**
 * Card-balance settlements only (pay down the card liability).
 * Do NOT treat all credit-card merchant purchases as payments.
 * Never match on the bare words "credit card".
 */
const CC_BALANCE_PAYMENT_RE =
  /\bonline\s+ach\s+payment(\s+thank\s+you)?\b|\bach\s+payment\s+thank\s+you\b|\bonline\s+payment\s+thank\s+you\b|\bautopay\b.*\b(payment|thank you)\b/i;
/** Explicit bank account transfers — not credit-card merchant charges. */
const TRANSFER_RE = /\b(transfer|xfer|tfr|acct transfer)\b/i;
const REFUND_RE = /\b(refund|return|credit memo|reversal)\b/i;

export interface MatchResult {
  updated: number;
  payments: number;
  transfers: number;
  refunds: number;
  duplicates: number;
  stillUnmatched: number;
}

function classifyRow(row: StatementRow): MatchStatus {
  const text = `${row.description} ${Object.values(row.raw).join(' ')}`;
  // Merchant card charges stay Unmatched for expense classification — only balance payments.
  if (CC_BALANCE_PAYMENT_RE.test(text)) return 'Payment';
  if (TRANSFER_RE.test(text)) return 'Transfer';
  if (REFUND_RE.test(text)) return 'Refund';
  return row.matchStatus === 'DuplicateRow' ? 'DuplicateRow' : 'Unmatched';
}

/**
 * Tag card-balance settlements / explicit transfers / refunds / duplicate imports
 * before expense categories. Local staging only — does not change QuickBooks.
 * Merchant card purchases are NOT payments merely because they hit a credit card.
 */
export function matchTransfersAndPayments(paths: GatewayPaths): MatchResult {
  const rows = loadStatementRows(paths.statementsPath);
  const bySig = new Map<string, StatementRow[]>();
  for (const row of rows) {
    const sig = `${row.txnDate ?? ''}|${row.amount == null ? '' : row.amount.toFixed(2)}|${row.description.trim().toLowerCase()}`;
    const list = bySig.get(sig) ?? [];
    list.push(row);
    bySig.set(sig, list);
  }

  let payments = 0;
  let transfers = 0;
  let refunds = 0;
  let duplicates = 0;
  let updated = 0;

  const next = rows.map((row) => {
    // Preserve read-only QBO Id links already attached locally.
    if (row.matchStatus === 'Matched' && row.matchedQboId) {
      return row;
    }
    const sig = `${row.txnDate ?? ''}|${row.amount == null ? '' : row.amount.toFixed(2)}|${row.description.trim().toLowerCase()}`;
    const peers = bySig.get(sig) ?? [];
    let status = classifyRow(row);
    if (peers.length > 1 && status === 'Unmatched') {
      status = 'DuplicateRow';
      duplicates += 1;
    }
    if (status === 'Payment') payments += 1;
    if (status === 'Transfer') transfers += 1;
    if (status === 'Refund') refunds += 1;
    if (status !== row.matchStatus) updated += 1;
    return {
      ...row,
      matchStatus: status,
      matchedQboId: null,
      proposedCategory: status === 'Unmatched' || status === 'Possible' ? row.proposedCategory : null,
    };
  });

  saveStatementRows(paths.statementsPath, next);
  refreshControlCountsFromLocal(paths);

  const stillUnmatched = next.filter((r) => r.matchStatus === 'Unmatched' || r.matchStatus === 'Possible').length;

  appendGatewayAudit(paths.auditLogPath, {
    action: 'match_transfers_and_payments',
    summary: 'Matched payments/transfers/refunds/duplicates in local staging',
    details: { updated, payments, transfers, refunds, duplicates, stillUnmatched },
  });

  return { updated, payments, transfers, refunds, duplicates, stillUnmatched };
}
