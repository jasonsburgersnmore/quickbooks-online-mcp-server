#!/usr/bin/env node
/**
 * Read-only sandbox verification for DDT Finance Foreman development credentials.
 * Prints company name, account sample count, and scoped purchase sample count.
 * Never prints tokens or secrets. Never writes to QuickBooks.
 */

import fs from 'fs';
import path from 'path';
import { defaultSandboxSnapshotReader, pullQboSnapshot } from './snapshot.js';
import { initGateway, packageRootDir } from './operations.js';
import { appendGatewayAudit } from './audit-log-file.js';
import { isWriteOperationAvailable, listUnavailableWriteOperations } from './write-guard.js';

async function main() {
  process.env.QUICKBOOKS_DISABLE_WRITE = 'true';
  process.env.QUICKBOOKS_DISABLE_UPDATE = 'true';
  process.env.QUICKBOOKS_DISABLE_DELETE = 'true';

  const root = packageRootDir();
  const paths = initGateway(root);
  const summary = await pullQboSnapshot(paths, defaultSandboxSnapshotReader);

  const report = {
    ok: true,
    environment: summary.environment,
    companyName: summary.companyName,
    accountCount: summary.accountCount,
    purchaseSampleCount: summary.purchaseSampleCount,
    snapshotFile: path.basename(summary.filePath),
    writeOperationsAvailable: isWriteOperationAvailable(),
    unavailableWriteOperations: listUnavailableWriteOperations(),
    note: 'Direct Intuit sandbox read-only verification completed. No paid CData dependency is used.',
  };

  const outPath = path.join(paths.rootDir, 'reports', 'sandbox-readonly-verify.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  appendGatewayAudit(paths.auditLogPath, {
    action: 'verify_sandbox_readonly',
    summary: 'Sandbox read-only verification passed',
    details: {
      companyName: summary.companyName,
      accountCount: summary.accountCount,
      purchaseSampleCount: summary.purchaseSampleCount,
    },
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        hint: 'If tokens are invalid, run: npm run auth  (browser OAuth against sandbox; callback http://localhost:8000/callback)',
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
