import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ClassificationRule } from '../classification/rules-engine.js';
import { appendGatewayAudit } from './audit-log-file.js';
import { stageBillScanReview, type StageBillScanInput } from './bill-scan-intake.js';
import { buildApprovalBatch } from './approval-batch.js';
import { classifyTransactions } from './classify-gateway.js';
import { detectDuplicates } from './duplicates.js';
import { ingestStatement } from './ingest.js';
import { matchTransfersAndPayments } from './matching.js';
import {
  defaultSandboxLinkCandidateReader,
  linkPaymentTagsToQboIds,
} from './link-qbo-ids.js';
import { recordOwnerAnswer } from './owner-answers.js';
import { reconciliationStatus } from './reconciliation.js';
import { defaultSandboxSnapshotReader, pullQboSnapshot } from './snapshot.js';
import {
  ensureGatewayDirs,
  listFinancialSources,
  resolveGatewayPaths,
  type GatewayPaths,
} from './store.js';
import {
  assertWriteOperationsUnavailable,
  isWriteOperationAvailable,
  listUnavailableWriteOperations,
} from './write-guard.js';

export function packageRootDir(): string {
  // dist/bookkeeping/gateway -> repo root; also works from src via ts-jest path mapping.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // .../src/bookkeeping/gateway or .../dist/bookkeeping/gateway
  return path.resolve(here, '..', '..', '..');
}

export function initGateway(rootDir: string = packageRootDir()): GatewayPaths {
  const paths = resolveGatewayPaths(rootDir);
  ensureGatewayDirs(paths);
  appendGatewayAudit(paths.auditLogPath, {
    action: 'gateway_init',
    summary: 'DDT Finance Gateway initialized (read-only / local staging)',
    details: {
      rootDir,
      writeOperationsAvailable: isWriteOperationAvailable(),
    },
  });
  return paths;
}

function loadDefaultRules(rootDir: string): ClassificationRule[] {
  const rulesPath = path.join(rootDir, 'data', 'templates', 'classification-rules.json');
  if (!fs.existsSync(rulesPath)) return [];
  const raw = JSON.parse(fs.readFileSync(rulesPath, 'utf8')) as { rules?: ClassificationRule[] };
  return Array.isArray(raw.rules) ? raw.rules : (raw as unknown as ClassificationRule[]);
}

export const gatewayOperations = {
  list_financial_sources(paths: GatewayPaths) {
    return listFinancialSources(paths);
  },
  async pull_qbo_snapshot(paths: GatewayPaths) {
    return pullQboSnapshot(paths, defaultSandboxSnapshotReader);
  },
  ingest_statement(paths: GatewayPaths, filePath: string) {
    return ingestStatement(paths, filePath);
  },
  detect_duplicates(paths: GatewayPaths) {
    return detectDuplicates(paths);
  },
  match_transfers_and_payments(paths: GatewayPaths) {
    return matchTransfersAndPayments(paths);
  },
  async link_payment_tags_to_qbo_ids(paths: GatewayPaths) {
    return linkPaymentTagsToQboIds(paths, defaultSandboxLinkCandidateReader);
  },
  classify_transactions(paths: GatewayPaths) {
    return classifyTransactions(paths, loadDefaultRules(paths.rootDir));
  },
  stage_bill_scan_review(paths: GatewayPaths, input: StageBillScanInput) {
    return stageBillScanReview(paths, input);
  },
  record_owner_answer(paths: GatewayPaths, questionId: string, answer: string) {
    return recordOwnerAnswer(paths, questionId, answer);
  },
  build_approval_batch(paths: GatewayPaths, batchId?: string) {
    return buildApprovalBatch(paths, batchId);
  },
  reconciliation_status(paths: GatewayPaths) {
    return reconciliationStatus(paths);
  },
  apply_approved_batch(_paths: GatewayPaths, _batchId?: string): never {
    return assertWriteOperationsUnavailable('apply_approved_batch');
  },
  list_unavailable_write_operations() {
    return listUnavailableWriteOperations();
  },
};
