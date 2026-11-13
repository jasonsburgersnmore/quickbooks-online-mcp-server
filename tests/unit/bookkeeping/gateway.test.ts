import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isToolDisabled } from '../../../src/helpers/register-tool';
import {
  DDT_FINANCE_GATEWAY_TOOLS,
  assertWriteOperationsUnavailable,
  detectDuplicates,
  fingerprintFile,
  formatControlRecordMarkdown,
  gatewayOperations,
  ingestStatement,
  initGateway,
  isWriteOperationAvailable,
  listUnavailableWriteOperations,
  matchTransfersAndPayments,
  classifyTransactions,
  stageBillScanReview,
  buildApprovalBatch,
  recordOwnerAnswer,
  reconciliationStatus,
  CONTROL_RECORD_BASELINE,
} from '../../../src/bookkeeping/gateway';
import { proposeClassification } from '../../../src/bookkeeping/classification/rules-engine';

describe('DDT Finance Gateway', () => {
  let tempRoot: string;
  const prevWrite = process.env.QUICKBOOKS_DISABLE_WRITE;
  const prevUpdate = process.env.QUICKBOOKS_DISABLE_UPDATE;
  const prevDelete = process.env.QUICKBOOKS_DISABLE_DELETE;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-gw-'));
    // Mirror expected template location for classify rules
    fs.mkdirSync(path.join(tempRoot, 'data', 'templates'), { recursive: true });
    const rulesSrc = path.join(process.cwd(), 'data', 'templates', 'classification-rules.json');
    if (fs.existsSync(rulesSrc)) {
      fs.copyFileSync(rulesSrc, path.join(tempRoot, 'data', 'templates', 'classification-rules.json'));
    }
    process.env.QUICKBOOKS_DISABLE_WRITE = 'true';
    process.env.QUICKBOOKS_DISABLE_UPDATE = 'true';
    process.env.QUICKBOOKS_DISABLE_DELETE = 'true';
  });

  afterEach(() => {
    if (prevWrite === undefined) delete process.env.QUICKBOOKS_DISABLE_WRITE;
    else process.env.QUICKBOOKS_DISABLE_WRITE = prevWrite;
    if (prevUpdate === undefined) delete process.env.QUICKBOOKS_DISABLE_UPDATE;
    else process.env.QUICKBOOKS_DISABLE_UPDATE = prevUpdate;
    if (prevDelete === undefined) delete process.env.QUICKBOOKS_DISABLE_DELETE;
    else process.env.QUICKBOOKS_DISABLE_DELETE = prevDelete;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('registers staged tools and keeps apply_approved_batch unavailable', () => {
    const names = DDT_FINANCE_GATEWAY_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'list_financial_sources',
        'pull_qbo_snapshot',
        'ingest_statement',
        'detect_duplicates',
        'match_transfers_and_payments',
        'link_payment_tags_to_qbo_ids',
        'classify_transactions',
        'stage_bill_scan_review',
        'record_owner_answer',
        'build_approval_batch',
        'reconciliation_status',
      ].sort(),
    );
    expect(names).not.toContain('apply_approved_batch');
    expect(isWriteOperationAvailable()).toBe(false);
    expect(listUnavailableWriteOperations()).toContain('apply_approved_batch');
    expect(() => assertWriteOperationsUnavailable('apply_approved_batch')).toThrow(/refuses/);
    expect(() => gatewayOperations.apply_approved_batch(initGateway(tempRoot))).toThrow(/refuses/);
  });

  it('stages mixed bill scans locally and rejects the same scan twice', () => {
    const paths = initGateway(tempRoot);
    const scanPath = path.join(tempRoot, 'mixed-scan.pdf');
    fs.writeFileSync(scanPath, 'test scan bytes', 'utf8');
    const input = {
      sourceFile: scanPath,
      documents: [
        {
          documentKind: 'utility_bill' as const,
          disposition: 'ready_for_bill_entry' as const,
          vendorOrIssuer: 'Example Gas Utility',
          documentDate: '2030-01-03',
          dueDate: '2030-01-30',
          totalAmount: 125.5,
          currentCharges: 45.5,
          previousBalance: 80,
          paymentsAndCredits: 0,
          accountLast4: null,
          operatingLane: 'Construction',
          proposedAccount: 'Utilities:Natural Gas',
          businessPurpose: 'Construction operations',
          notes: ['Local staging only'],
        },
      ],
    };

    const first = stageBillScanReview(paths, input);
    expect(first.accepted).toBe(true);
    expect(first.review?.quickBooksWritePerformed).toBe(false);
    expect(first.review?.paymentPerformed).toBe(false);
    expect(first.review?.documents[0].operatingLane).toBe('Construction');

    const second = stageBillScanReview(paths, input);
    expect(second.accepted).toBe(false);
    expect(second.duplicateOf).toBe(first.review?.reviewId);
  });

  it('proves QuickBooks write/update/delete MCP tools stay disabled', () => {
    expect(isToolDisabled('create_purchase')).toBe(true);
    expect(isToolDisabled('update_purchase')).toBe(true);
    expect(isToolDisabled('delete_purchase')).toBe(true);
    expect(isToolDisabled('create_bill')).toBe(true);
    expect(isToolDisabled('update_account')).toBe(true);
    expect(isToolDisabled('delete_journal_entry')).toBe(true);
    expect(isToolDisabled('list_financial_sources')).toBe(false);
    expect(isToolDisabled('get_company_info')).toBe(false);
  });

  it('uses a public-safe zero baseline and keeps real counts local', () => {
    expect(CONTROL_RECORD_BASELINE.qboPurchaseLines).toBe(0);
    expect(CONTROL_RECORD_BASELINE.importedStatementRows).toBe(0);
    expect(CONTROL_RECORD_BASELINE.unmatchedOrPossibleRows).toBe(0);
    expect(CONTROL_RECORD_BASELINE.fullyMatchedRows).toBe(0);
    const md = formatControlRecordMarkdown(CONTROL_RECORD_BASELINE);
    expect(md).toMatch(/QuickBooks purchase lines: 0/);
    expect(md).toMatch(/Fully matched rows: 0/);
  });

  it('fingerprints before ingest and skips duplicate files', () => {
    const paths = initGateway(tempRoot);
    const csvPath = path.join(tempRoot, 'stmt.csv');
    fs.writeFileSync(
      csvPath,
      'Date,Description,Amount\n2025-01-02,SHELL OIL,12.34\n2025-01-03,INTERNET PAYMENT - THANKYOU,99.00\n',
      'utf8',
    );

    const fp = fingerprintFile(csvPath, paths.fingerprintStorePath);
    expect(fp.sha256).toHaveLength(64);
    expect(fp.duplicateOf).toBeNull();

    const first = ingestStatement(paths, csvPath);
    expect(first.accepted).toBe(true);
    expect(first.rowsAdded).toBeGreaterThan(0);

    const second = ingestStatement(paths, csvPath);
    expect(second.accepted).toBe(false);
    expect(second.reason).toMatch(/duplicate/i);
  });

  it('matches payments before classification and builds a non-applied batch', () => {
    const paths = initGateway(tempRoot);
    const csvPath = path.join(tempRoot, 'flow.csv');
    fs.writeFileSync(
      csvPath,
      'Date,Description,Amount\n2025-02-01,PILOT_00332,20.00\n2025-02-02,ONLINE ACH PAYMENT THANK YOU,500.00\n2025-02-01,PILOT_00332,20.00\n',
      'utf8',
    );
    ingestStatement(paths, csvPath);
    detectDuplicates(paths);
    matchTransfersAndPayments(paths);
    classifyTransactions(paths, [
      {
        id: 'fuel-test',
        enabled: true,
        priority: 1,
        vendorPattern: 'pilot',
        action: 'ProposeCategory',
        proposedCategory: 'Fuel',
        requiresVehicle: true,
        requiresLane: true,
        requiresItemEvidence: false,
        requiresBusinessPurpose: false,
        autoPromoteAfterApprovals: 3,
        approvalCount: 0,
        notes: 'test',
      },
    ]);

    const paymentProposal = proposeClassification(
      {
        vendor: 'ONLINE ACH PAYMENT THANK YOU',
        description: 'ONLINE ACH PAYMENT THANK YOU',
        amount: 500,
        hasItemEvidence: false,
        hasBusinessPurpose: false,
        vehicleEstablished: false,
        laneEstablished: false,
        isRefund: false,
      },
      [],
    );
    expect(paymentProposal.action).toBe('IgnoreAsNonExpense');

    const batch = buildApprovalBatch(paths);
    expect(batch).toBeTruthy();
    recordOwnerAnswer(paths, 'Q1', 'unit-test answer');
    const status = reconciliationStatus(paths);
    expect(status.applyApprovedBatchAvailable).toBe(false);
    expect(status.control.fullyMatchedRows).toBe(0);
    expect(gatewayOperations.list_financial_sources(paths).some((s) => s.id === 'qbo-direct-api')).toBe(
      true,
    );
    expect(gatewayOperations.list_financial_sources(paths).some((s) => s.id.includes('cdata'))).toBe(false);
  });
});
