import { appendGatewayAudit } from './audit-log-file.js';
import {
  GatewayPaths,
  loadStatementRows,
  refreshControlCountsFromLocal,
  saveStatementRows,
} from './store.js';
import type { MatchStatus, StatementRow } from './types.js';

export interface QboLinkCandidate {
  id: string;
  entityType: string;
  txnDate: string; // YYYY-MM-DD
  amount: number;
  payee: string | null;
  memo: string | null;
}

export interface LinkQboIdsResult {
  considered: number;
  linked: number;
  ambiguous: number;
  noCandidate: number;
  skippedAlreadyMatched: number;
  candidatePoolSize: number;
  environment: string;
}

const LINKABLE_STATUSES: ReadonlySet<MatchStatus> = new Set([
  'Payment',
  'Transfer',
  'Refund',
  'Possible',
]);

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function amountClose(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= tol;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function descOverlap(row: StatementRow, candidate: QboLinkCandidate): number {
  const rowTokens = tokenize(`${row.description} ${Object.values(row.raw).join(' ')}`);
  const candTokens = tokenize(`${candidate.payee ?? ''} ${candidate.memo ?? ''}`);
  if (rowTokens.size === 0 || candTokens.size === 0) return 0;
  let hit = 0;
  for (const t of candTokens) {
    if (rowTokens.has(t)) hit += 1;
  }
  return hit / candTokens.size;
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(Date.parse(a) - Date.parse(b));
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Score a candidate. Higher is better.
 * High-confidence unique matches require score >= 100 (exact date + amount).
 */
export function scoreCandidate(row: StatementRow, candidate: QboLinkCandidate): number {
  if (row.amount == null) return -1;
  if (!amountClose(row.amount, candidate.amount)) return -1;
  const rowDate = normalizeDate(row.txnDate);
  if (!rowDate) return -1;
  const dayDiff = daysBetween(rowDate, candidate.txnDate);
  if (dayDiff > 1) return -1;

  let score = 50; // amount match
  if (dayDiff === 0) score += 50;
  else score += 20; // ±1 day

  const overlap = descOverlap(row, candidate);
  if (overlap >= 0.34) score += 25;
  else if (overlap > 0) score += 10;

  return score;
}

/**
 * Decide link outcome for one row against a candidate pool.
 * Never invents: requires unique high-confidence winner.
 */
export function decideLink(
  row: StatementRow,
  pool: QboLinkCandidate[],
): { outcome: 'linked' | 'ambiguous' | 'no_candidate'; qboId: string | null; reason: string } {
  const scored = pool
    .map((c) => ({ c, score: scoreCandidate(row, c) }))
    .filter((x) => x.score >= 70)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { outcome: 'no_candidate', qboId: null, reason: 'No sandbox QBO candidate with date+amount' };
  }

  const top = scored[0];
  const ties = scored.filter((x) => x.score === top.score && x.c.id !== top.c.id);
  // High confidence only for exact date+amount (score >= 100) with no tie
  if (top.score >= 100 && ties.length === 0) {
    return {
      outcome: 'linked',
      qboId: top.c.id,
      reason: `Unique high-confidence ${top.c.entityType} match`,
    };
  }
  return {
    outcome: 'ambiguous',
    qboId: null,
    reason:
      ties.length > 0
        ? `Ambiguous: ${ties.length + 1} candidates with equal score`
        : `Near match only (score ${top.score}); needs owner confirmation`,
  };
}

export type QboCandidateReader = () => Promise<QboLinkCandidate[]>;

/**
 * Read-only link of local Payment/Transfer/Refund rows to sandbox QBO Ids.
 * Updates local staging only — never writes to QuickBooks.
 */
export async function linkPaymentTagsToQboIds(
  paths: GatewayPaths,
  reader: QboCandidateReader,
): Promise<LinkQboIdsResult> {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  if (environment !== 'sandbox') {
    throw new Error('linkPaymentTagsToQboIds refuses non-sandbox environments');
  }

  const pool = await reader();
  const rows = loadStatementRows(paths.statementsPath);

  let linked = 0;
  let ambiguous = 0;
  let noCandidate = 0;
  let skippedAlreadyMatched = 0;
  let considered = 0;

  const usedQboIds = new Set(
    rows.filter((r) => r.matchStatus === 'Matched' && r.matchedQboId).map((r) => r.matchedQboId as string),
  );

  const next = rows.map((row) => {
    if (row.matchStatus === 'Matched' && row.matchedQboId) {
      skippedAlreadyMatched += 1;
      return row;
    }
    if (!LINKABLE_STATUSES.has(row.matchStatus)) {
      return row;
    }
    considered += 1;
    // Exclude QBO Ids already claimed by another local row
    const available = pool.filter((c) => !usedQboIds.has(c.id));
    const decision = decideLink(row, available);
    if (decision.outcome === 'linked' && decision.qboId) {
      linked += 1;
      usedQboIds.add(decision.qboId);
      return {
        ...row,
        matchStatus: 'Matched' as const,
        matchedQboId: decision.qboId,
      };
    }
    if (decision.outcome === 'ambiguous') {
      ambiguous += 1;
      return {
        ...row,
        matchStatus: 'NeedsOwnerAnswer' as const,
        matchedQboId: null,
      };
    }
    noCandidate += 1;
    // Keep Payment/Transfer/Refund tag; do not invent a match
    return row;
  });

  saveStatementRows(paths.statementsPath, next);
  refreshControlCountsFromLocal(paths);

  appendGatewayAudit(paths.auditLogPath, {
    action: 'link_payment_tags_to_qbo_ids',
    summary: `Linked ${linked} local payment/transfer/refund row(s) to sandbox QBO Ids (read-only)`,
    details: {
      considered,
      linked,
      ambiguous,
      noCandidate,
      skippedAlreadyMatched,
      candidatePoolSize: pool.length,
      environment,
      writeOperations: false,
    },
  });

  return {
    considered,
    linked,
    ambiguous,
    noCandidate,
    skippedAlreadyMatched,
    candidatePoolSize: pool.length,
    environment,
  };
}

function callQb<T>(qb: any, method: string, criteria: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    qb[method](criteria, (err: unknown, data: T) => (err ? reject(err) : resolve(data)));
  });
}

function fromQuery<T>(resp: any, key: string): T[] {
  const list = resp?.QueryResponse?.[key];
  return Array.isArray(list) ? list : [];
}

/**
 * Sandbox-only reader of payment-like QBO entities (read-only find*).
 */
export async function defaultSandboxLinkCandidateReader(): Promise<QboLinkCandidate[]> {
  const { QuickbooksClient } = await import('../../clients/quickbooks-client.js');
  const qb = await QuickbooksClient.getInstance();
  const limit = [{ field: 'limit', value: 1000 }];

  const [purchases, payments, billPayments, deposits, transfers, refunds, credits] =
    await Promise.all([
      callQb<any>(qb, 'findPurchases', limit),
      callQb<any>(qb, 'findPayments', limit),
      callQb<any>(qb, 'findBillPayments', limit),
      callQb<any>(qb, 'findDeposits', limit),
      callQb<any>(qb, 'findTransfers', limit),
      callQb<any>(qb, 'findRefundReceipts', limit).catch(() => ({ QueryResponse: {} })),
      callQb<any>(qb, 'findCreditMemos', limit).catch(() => ({ QueryResponse: {} })),
    ]);

  const out: QboLinkCandidate[] = [];

  for (const p of fromQuery<any>(purchases, 'Purchase')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'Purchase',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: p.EntityRef?.name ?? null,
      memo: p.PrivateNote ?? p.DocNumber ?? null,
    });
  }
  for (const p of fromQuery<any>(payments, 'Payment')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'Payment',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: p.CustomerRef?.name ?? null,
      memo: p.PrivateNote ?? null,
    });
  }
  for (const p of fromQuery<any>(billPayments, 'BillPayment')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'BillPayment',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: p.VendorRef?.name ?? null,
      memo: p.PrivateNote ?? null,
    });
  }
  for (const p of fromQuery<any>(deposits, 'Deposit')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'Deposit',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: null,
      memo: p.PrivateNote ?? null,
    });
  }
  for (const p of fromQuery<any>(transfers, 'Transfer')) {
    const date = normalizeDate(p.TxnDate);
    const amount = p.Amount ?? p.TotalAmt;
    if (!date || amount == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'Transfer',
      txnDate: date,
      amount: Number(amount),
      payee: null,
      memo: p.PrivateNote ?? null,
    });
  }
  for (const p of fromQuery<any>(refunds, 'RefundReceipt')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'RefundReceipt',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: p.CustomerRef?.name ?? null,
      memo: p.PrivateNote ?? null,
    });
  }
  for (const p of fromQuery<any>(credits, 'CreditMemo')) {
    const date = normalizeDate(p.TxnDate);
    if (!date || p.TotalAmt == null || !p.Id) continue;
    out.push({
      id: String(p.Id),
      entityType: 'CreditMemo',
      txnDate: date,
      amount: Number(p.TotalAmt),
      payee: p.CustomerRef?.name ?? null,
      memo: p.PrivateNote ?? null,
    });
  }

  return out;
}
