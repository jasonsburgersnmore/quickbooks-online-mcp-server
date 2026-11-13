import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { MatchStatus, StatementRow } from './types.js';
import {
  fingerprintFile,
  markFingerprintIngested,
} from './fingerprint.js';
import { appendGatewayAudit } from './audit-log-file.js';
import {
  GatewayPaths,
  loadStatementRows,
  refreshControlCountsFromLocal,
  saveStatementRows,
} from './store.js';

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function guessAmount(raw: Record<string, string>): number | null {
  for (const key of Object.keys(raw)) {
    if (/amount|amt|debit|credit|value/i.test(key)) {
      const n = Number(String(raw[key]).replace(/[$,]/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function guessDate(raw: Record<string, string>): string | null {
  for (const key of Object.keys(raw)) {
    if (/date|posted|txn/i.test(key)) {
      const v = raw[key]?.trim();
      if (v) return v;
    }
  }
  return null;
}

function guessDescription(raw: Record<string, string>): string {
  for (const key of Object.keys(raw)) {
    if (/desc|memo|payee|name|merchant|detail/i.test(key)) {
      if (raw[key]) return raw[key];
    }
  }
  return Object.values(raw).filter(Boolean).slice(0, 3).join(' | ');
}

export interface IngestResult {
  accepted: boolean;
  reason: string;
  fingerprintSha256: string;
  duplicateOf: string | null;
  rowsAdded: number;
  totalRows: number;
}

/**
 * Fingerprint-first statement ingest into local staging only (never posts to QBO).
 */
export function ingestStatement(paths: GatewayPaths, filePath: string): IngestResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Statement file not found: ${filePath}`);
  }

  const fp = fingerprintFile(filePath, paths.fingerprintStorePath);
  if (fp.duplicateOf) {
    appendGatewayAudit(paths.auditLogPath, {
      action: 'ingest_statement_rejected_duplicate',
      summary: 'Rejected duplicate file before ingest',
      details: {
        path: path.basename(filePath),
        sha256Prefix: fp.sha256.slice(0, 12),
        duplicateOf: path.basename(fp.duplicateOf),
      },
    });
    return {
      accepted: false,
      reason: 'Duplicate file fingerprint — ingest blocked',
      fingerprintSha256: fp.sha256,
      duplicateOf: fp.duplicateOf,
      rowsAdded: 0,
      totalRows: loadStatementRows(paths.statementsPath).length,
    };
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row');
  }
  const headers = parseCsvLine(lines[0]);
  const existing = loadStatementRows(paths.statementsPath);
  const added: StatementRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h || `col${idx}`] = cells[idx] ?? '';
    });
    const rowId = crypto
      .createHash('sha256')
      .update(`${fp.sha256}|${i}|${JSON.stringify(raw)}`)
      .digest('hex')
      .slice(0, 24);
    added.push({
      rowId,
      sourceFileSha256: fp.sha256,
      txnDate: guessDate(raw),
      amount: guessAmount(raw),
      description: guessDescription(raw),
      raw,
      matchStatus: 'Unmatched' as MatchStatus,
      matchedQboId: null,
      proposedCategory: null,
    });
  }

  const merged = [...existing, ...added];
  saveStatementRows(paths.statementsPath, merged);
  markFingerprintIngested(paths.fingerprintStorePath, fp.sha256);
  refreshControlCountsFromLocal(paths);

  appendGatewayAudit(paths.auditLogPath, {
    action: 'ingest_statement',
    summary: `Ingested ${added.length} statement row(s) into local staging`,
    details: {
      path: path.basename(filePath),
      sha256Prefix: fp.sha256.slice(0, 12),
      rowsAdded: added.length,
      totalRows: merged.length,
    },
  });

  return {
    accepted: true,
    reason: 'Ingested to local staging only (no QuickBooks write)',
    fingerprintSha256: fp.sha256,
    duplicateOf: null,
    rowsAdded: added.length,
    totalRows: merged.length,
  };
}
