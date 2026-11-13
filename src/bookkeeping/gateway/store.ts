import fs from 'fs';
import path from 'path';
import type {
  BillScanReview,
  FinancialSourceKind,
  OwnerAnswer,
  StatementRow,
} from './types.js';
import { defaultControlRecordPath, ensureControlRecord, loadControlRecord, saveControlRecord } from './control-record.js';
import { defaultFingerprintStorePath, loadFingerprints } from './fingerprint.js';
import { defaultAuditLogPath } from './audit-log-file.js';

export interface GatewayPaths {
  rootDir: string;
  controlRecordPath: string;
  fingerprintStorePath: string;
  auditLogPath: string;
  statementsPath: string;
  ownerAnswersPath: string;
  batchesDir: string;
  snapshotsDir: string;
  billScanReviewsPath: string;
}

export function resolveGatewayPaths(rootDir: string): GatewayPaths {
  const local = path.join(rootDir, 'data', 'local');
  return {
    rootDir,
    controlRecordPath: defaultControlRecordPath(rootDir),
    fingerprintStorePath: defaultFingerprintStorePath(rootDir),
    auditLogPath: defaultAuditLogPath(rootDir),
    statementsPath: path.join(local, 'statement-rows.json'),
    ownerAnswersPath: path.join(local, 'owner-answers.json'),
    batchesDir: path.join(local, 'approval-batches'),
    snapshotsDir: path.join(local, 'qbo-snapshots'),
    billScanReviewsPath: path.join(local, 'bill-scan-reviews.json'),
  };
}

export function loadBillScanReviews(filePath: string): BillScanReview[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BillScanReview[];
  return Array.isArray(raw) ? raw : [];
}

export function saveBillScanReviews(filePath: string, reviews: BillScanReview[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
}

export function ensureGatewayDirs(paths: GatewayPaths): void {
  fs.mkdirSync(path.dirname(paths.controlRecordPath), { recursive: true });
  fs.mkdirSync(paths.batchesDir, { recursive: true });
  fs.mkdirSync(paths.snapshotsDir, { recursive: true });
  ensureControlRecord(paths.controlRecordPath);
}

export function loadStatementRows(filePath: string): StatementRow[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StatementRow[];
  return Array.isArray(raw) ? raw : [];
}

export function saveStatementRows(filePath: string, rows: StatementRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
}

export function loadOwnerAnswers(filePath: string): OwnerAnswer[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OwnerAnswer[];
  return Array.isArray(raw) ? raw : [];
}

export function saveOwnerAnswers(filePath: string, answers: OwnerAnswer[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(answers, null, 2)}\n`, 'utf8');
}

export interface FinancialSourceDescriptor {
  id: string;
  kind: FinancialSourceKind;
  label: string;
  access: 'read_only' | 'local_file';
  status: 'available' | 'configured' | 'missing';
  notes: string;
}

export function listFinancialSources(paths: GatewayPaths): FinancialSourceDescriptor[] {
  const env = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  const hasClientCredentials = Boolean(
    process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET,
  );
  const hasTokens = Boolean(
    process.env.QUICKBOOKS_REFRESH_TOKEN && process.env.QUICKBOOKS_REALM_ID,
  );
  const fingerprints = loadFingerprints(paths.fingerprintStorePath);
  const control = loadControlRecord(paths.controlRecordPath);

  return [
    {
      id: 'qbo-direct-api',
      kind: 'qbo_direct_api',
      label: `Direct Intuit QuickBooks Online API (${env})`,
      access: 'read_only',
      status:
        hasClientCredentials && hasTokens
          ? 'configured'
          : hasClientCredentials
            ? 'available'
            : 'missing',
      notes:
        env === 'production'
          ? 'Direct production OAuth connection through the local Intuit MCP. DDT gateway writes remain disabled.'
          : 'Direct sandbox OAuth connection through the local Intuit MCP. This is not live-company access.',
    },
    {
      id: 'local-statements',
      kind: 'bank_statement',
      label: 'Local statement / CSV intake',
      access: 'local_file',
      status: fingerprints.length > 0 ? 'configured' : 'available',
      notes: `${fingerprints.length} fingerprinted file(s); control shows ${control.importedStatementRows} imported rows.`,
    },
    {
      id: 'workbook-control',
      kind: 'workbook_control',
      label: 'Human-readable control record',
      access: 'local_file',
      status: 'configured',
      notes: `Purchases=${control.qboPurchaseLines}; unmatched/possible=${control.unmatchedOrPossibleRows}; fully matched=${control.fullyMatchedRows}.`,
    },
  ];
}

export function refreshControlCountsFromLocal(paths: GatewayPaths): void {
  const rows = loadStatementRows(paths.statementsPath);
  const control = loadControlRecord(paths.controlRecordPath);
  const unmatched = rows.filter((r) =>
    r.matchStatus === 'Unmatched' || r.matchStatus === 'Possible' || r.matchStatus === 'NeedsOwnerAnswer',
  ).length;
  // "Fully matched" means linked to a QBO transaction Id — not merely tagged as payment/transfer.
  const matched = rows.filter((r) => r.matchStatus === 'Matched' && Boolean(r.matchedQboId)).length;
  saveControlRecord(paths.controlRecordPath, {
    ...control,
    importedStatementRows: rows.length || control.importedStatementRows,
    unmatchedOrPossibleRows: rows.length ? unmatched : control.unmatchedOrPossibleRows,
    fullyMatchedRows: rows.length ? matched : control.fullyMatchedRows,
  });
}
