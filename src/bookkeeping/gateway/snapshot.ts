import fs from 'fs';
import path from 'path';
import { appendGatewayAudit } from './audit-log-file.js';
import { GatewayPaths } from './store.js';

export interface QboSnapshotSummary {
  savedAt: string;
  environment: string;
  companyName: string | null;
  accountCount: number;
  purchaseSampleCount: number;
  filePath: string;
  note: string;
}

export type SnapshotReader = () => Promise<{
  companyName: string | null;
  accounts: Array<{ Id?: string; Name?: string; AccountType?: string }>;
  purchases: Array<{ Id?: string; TxnDate?: string; TotalAmt?: number }>;
}>;

/**
 * Pull a scoped read-only QBO snapshot into local files. Never writes to QuickBooks.
 */
export async function pullQboSnapshot(
  paths: GatewayPaths,
  reader: SnapshotReader,
): Promise<QboSnapshotSummary> {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
  if (environment !== 'sandbox') {
    throw new Error(
      'pull_qbo_snapshot refuses non-sandbox environments while using development credentials',
    );
  }

  const data = await reader();
  const savedAt = new Date().toISOString();
  const stamp = savedAt.replace(/[:.]/g, '-');
  fs.mkdirSync(paths.snapshotsDir, { recursive: true });
  const filePath = path.join(paths.snapshotsDir, `snapshot-${stamp}.json`);
  const payload = {
    savedAt,
    environment,
    companyName: data.companyName,
    accountCount: data.accounts.length,
    purchaseSampleCount: data.purchases.length,
    accounts: data.accounts.map((a) => ({
      Id: a.Id ?? null,
      Name: a.Name ?? null,
      AccountType: a.AccountType ?? null,
    })),
    purchases: data.purchases.map((p) => ({
      Id: p.Id ?? null,
      TxnDate: p.TxnDate ?? null,
      TotalAmt: p.TotalAmt ?? null,
    })),
    note: 'Read-only sandbox snapshot. No create/update/delete performed.',
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  appendGatewayAudit(paths.auditLogPath, {
    action: 'pull_qbo_snapshot',
    summary: 'Saved read-only sandbox QBO snapshot locally',
    details: {
      environment,
      accountCount: data.accounts.length,
      purchaseSampleCount: data.purchases.length,
      companyName: data.companyName,
    },
  });

  return {
    savedAt,
    environment,
    companyName: data.companyName,
    accountCount: data.accounts.length,
    purchaseSampleCount: data.purchases.length,
    filePath,
    note: payload.note,
  };
}

/** Default reader using the existing QuickBooks client (sandbox). */
export async function defaultSandboxSnapshotReader(): Promise<{
  companyName: string | null;
  accounts: Array<{ Id?: string; Name?: string; AccountType?: string }>;
  purchases: Array<{ Id?: string; TxnDate?: string; TotalAmt?: number }>;
}> {
  const { quickbooksClient } = await import('../../clients/quickbooks-client.js');
  const qbo = await quickbooksClient.authenticate();
  const company = await new Promise<any>((resolve, reject) => {
    (qbo as any).getCompanyInfo((qbo as any).realmId, (err: unknown, info: unknown) =>
      err ? reject(err) : resolve(info),
    );
  });
  const accountsResp = await new Promise<any>((resolve, reject) => {
    (qbo as any).findAccounts({ limit: 50 }, (err: unknown, data: unknown) =>
      err ? reject(err) : resolve(data),
    );
  });
  const purchasesResp = await new Promise<any>((resolve, reject) => {
    (qbo as any).findPurchases(
      [
        { field: 'TxnDate', value: '2024-01-01', operator: '>=' },
        { field: 'limit', value: 25 },
      ],
      (err: unknown, data: unknown) => (err ? reject(err) : resolve(data)),
    );
  });

  const accounts =
    accountsResp?.QueryResponse?.Account ??
    (Array.isArray(accountsResp) ? accountsResp : []);
  const purchases =
    purchasesResp?.QueryResponse?.Purchase ??
    (Array.isArray(purchasesResp) ? purchasesResp : []);

  return {
    companyName: company?.CompanyName ?? company?.companyName ?? null,
    accounts: accounts.slice(0, 50),
    purchases: purchases.slice(0, 25),
  };
}
