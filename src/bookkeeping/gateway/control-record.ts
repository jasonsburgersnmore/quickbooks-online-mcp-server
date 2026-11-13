import fs from 'fs';
import path from 'path';
import type { ControlRecordSnapshot } from './types.js';

/** Public-safe baseline. Real counts are kept only in the git-ignored local control record. */
export const CONTROL_RECORD_BASELINE: ControlRecordSnapshot = {
  title: 'DDT Finance human-readable control record',
  updatedAt: '1970-01-01T00:00:00.000Z',
  environmentNote:
    'Template counts start at zero. The local Intuit QuickBooks MCP is the accounting API source; sandbox credentials are not live-company access, and production use requires separate Intuit OAuth authorization.',
  qboPurchaseLines: 0,
  importedStatementRows: 0,
  unmatchedOrPossibleRows: 0,
  fullyMatchedRows: 0,
  fingerprintFirst: true,
  matchBeforeClassify: true,
  notes: [
    'Fingerprint duplicate files before ingesting anything else.',
    'Match payments, transfers, refunds, and duplicate imports before proposing expense categories.',
    'Do not implement or call apply_approved_batch yet.',
    'Do not add a paid SQL adapter or bypass the DDT approval gate; use the direct Intuit MCP connection.',
  ],
};

export function defaultControlRecordPath(rootDir: string): string {
  return path.join(rootDir, 'data', 'local', 'control-record.json');
}

export function loadControlRecord(filePath: string): ControlRecordSnapshot {
  if (!fs.existsSync(filePath)) {
    return { ...CONTROL_RECORD_BASELINE, notes: [...CONTROL_RECORD_BASELINE.notes] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ControlRecordSnapshot;
  return {
    ...CONTROL_RECORD_BASELINE,
    ...raw,
    notes: Array.isArray(raw.notes) ? raw.notes : [...CONTROL_RECORD_BASELINE.notes],
  };
}

export function saveControlRecord(filePath: string, record: ControlRecordSnapshot): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const toWrite: ControlRecordSnapshot = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(toWrite, null, 2)}\n`, 'utf8');
}

export function ensureControlRecord(filePath: string): ControlRecordSnapshot {
  if (!fs.existsSync(filePath)) {
    saveControlRecord(filePath, CONTROL_RECORD_BASELINE);
  }
  return loadControlRecord(filePath);
}

export function formatControlRecordMarkdown(record: ControlRecordSnapshot): string {
  const lines = [
    `# ${record.title}`,
    '',
    `- Updated: ${record.updatedAt}`,
    `- QuickBooks purchase lines: ${record.qboPurchaseLines.toLocaleString('en-US')}`,
    `- Imported statement rows: ${record.importedStatementRows.toLocaleString('en-US')}`,
    `- Unmatched or possible rows: ${record.unmatchedOrPossibleRows.toLocaleString('en-US')}`,
    `- Fully matched rows: ${record.fullyMatchedRows.toLocaleString('en-US')}`,
    `- Fingerprint before ingest: ${record.fingerprintFirst ? 'yes' : 'no'}`,
    `- Match before classify: ${record.matchBeforeClassify ? 'yes' : 'no'}`,
    '',
    record.environmentNote,
    '',
    '## Notes',
    ...record.notes.map((n) => `- ${n}`),
    '',
  ];
  return lines.join('\n');
}
