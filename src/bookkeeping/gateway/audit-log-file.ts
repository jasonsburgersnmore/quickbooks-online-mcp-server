import fs from 'fs';
import path from 'path';
import type { GatewayAuditEvent } from './types.js';

const SECRET_KEY_RE =
  /(secret|token|password|authorization|refresh|access.?token|client.?secret|account.?number|routing)/i;

export function defaultAuditLogPath(rootDir: string): string {
  return path.join(rootDir, 'data', 'local', 'gateway-audit.jsonl');
}

export function sanitizeDetails(
  details: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string' && SECRET_KEY_RE.test(value)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function appendGatewayAudit(
  logPath: string,
  event: Omit<GatewayAuditEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): GatewayAuditEvent {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const full: GatewayAuditEvent = {
    id: event.id ?? `gw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp ?? new Date().toISOString(),
    action: event.action,
    summary: event.summary,
    details: sanitizeDetails(event.details),
  };
  const line = `${JSON.stringify(full)}\n`;
  try {
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (error: any) {
    // Some managed Windows filesystems can return EBADF for append handles
    // even when ordinary reads and atomic replacement are available. Preserve
    // the existing audit trail and retry through a sibling temp file.
    if (error?.code !== 'EBADF') throw error;
    const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const tmpPath = `${logPath}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(tmpPath, `${existing}${line}`, 'utf8');
      fs.renameSync(tmpPath, logPath);
    } catch (fallbackError) {
      try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
      throw fallbackError;
    }
  }
  return full;
}

export function readGatewayAudit(logPath: string): GatewayAuditEvent[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GatewayAuditEvent);
}
