import { z } from 'zod';
import { ToolDefinition } from '../../types/tool-definition.js';
import { gatewayOperations, initGateway, packageRootDir } from './operations.js';

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

const emptySchema = z.object({});

export const ListFinancialSourcesTool: ToolDefinition<typeof emptySchema> = {
  name: 'list_financial_sources',
  description:
    'List configured financial sources (direct Intuit QuickBooks API and local statements). No paid CData dependency.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.list_financial_sources(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const PullQboSnapshotTool: ToolDefinition<typeof emptySchema> = {
  name: 'pull_qbo_snapshot',
  description:
    'Read-only sandbox snapshot: company info, chart of accounts sample, scoped purchases. Saves locally; never writes to QuickBooks.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(await gatewayOperations.pull_qbo_snapshot(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

const ingestSchema = z.object({
  file_path: z.string().describe('Absolute path to a local CSV statement file'),
});

export const IngestStatementTool: ToolDefinition<typeof ingestSchema> = {
  name: 'ingest_statement',
  description:
    'Fingerprint the file first; reject duplicates; ingest rows into local staging only (no QuickBooks import).',
  schema: ingestSchema,
  handler: async ({ params }: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.ingest_statement(paths, params.file_path));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const DetectDuplicatesTool: ToolDefinition<typeof emptySchema> = {
  name: 'detect_duplicates',
  description: 'Detect duplicate statement files (SHA-256) and duplicate rows in local staging.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.detect_duplicates(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const MatchTransfersAndPaymentsTool: ToolDefinition<typeof emptySchema> = {
  name: 'match_transfers_and_payments',
  description:
    'Match payments, transfers, refunds, and duplicate imports in local staging before expense categories.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.match_transfers_and_payments(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const LinkPaymentTagsToQboIdsTool: ToolDefinition<typeof emptySchema> = {
  name: 'link_payment_tags_to_qbo_ids',
  description:
    'Read-only sandbox lookup: link local Payment/Transfer/Refund rows to unique high-confidence QBO Ids (date+amount). Ambiguous cases become NeedsOwnerAnswer. Never writes to QuickBooks.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(await gatewayOperations.link_payment_tags_to_qbo_ids(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const ClassifyTransactionsTool: ToolDefinition<typeof emptySchema> = {
  name: 'classify_transactions',
  description:
    'Propose expense categories for unmatched local rows using classification rules. Skips payments/transfers/refunds/duplicates. Does not post to QuickBooks.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.classify_transactions(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

const scanDocumentSchema = z.object({
  document_kind: z.enum([
    'vendor_bill',
    'utility_bill',
    'credit_card_statement',
    'bank_statement',
    'loan_statement',
    'compliance_notice',
    'other',
  ]),
  disposition: z.enum([
    'ready_for_bill_entry',
    'statement_payment_due',
    'financing_record',
    'evidence_only',
    'review_hold',
    'needs_owner_answer',
  ]),
  vendor_or_issuer: z.string().min(1),
  document_date: z.string().nullable(),
  due_date: z.string().nullable(),
  total_amount: z.number().nonnegative().nullable(),
  current_charges: z.number().nonnegative().nullable(),
  previous_balance: z.number().nonnegative().nullable(),
  payments_and_credits: z.number().nonnegative().nullable(),
  account_last4: z.string().regex(/^\d{4}$/).nullable(),
  operating_lane: z.string().nullable(),
  proposed_account: z.string().nullable(),
  business_purpose: z.string().nullable(),
  notes: z.array(z.string()).default([]),
});

const billScanSchema = z.object({
  source_file: z.string().describe('Absolute path to the source scan PDF or image'),
  documents: z.array(scanDocumentSchema).min(1),
});

export const StageBillScanReviewTool: ToolDefinition<typeof billScanSchema> = {
  name: 'stage_bill_scan_review',
  description:
    'Stage a reviewed mixed-document scan locally. Separates bills, card/bank statements, loans, and compliance notices; fingerprints duplicates; never writes to QuickBooks or pays anything.',
  schema: billScanSchema,
  handler: async ({ params }: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(
        gatewayOperations.stage_bill_scan_review(paths, {
          sourceFile: params.source_file,
          documents: params.documents.map((document: any) => ({
            documentKind: document.document_kind,
            disposition: document.disposition,
            vendorOrIssuer: document.vendor_or_issuer,
            documentDate: document.document_date,
            dueDate: document.due_date,
            totalAmount: document.total_amount,
            currentCharges: document.current_charges,
            previousBalance: document.previous_balance,
            paymentsAndCredits: document.payments_and_credits,
            accountLast4: document.account_last4,
            operatingLane: document.operating_lane,
            proposedAccount: document.proposed_account,
            businessPurpose: document.business_purpose,
            notes: document.notes,
          })),
        }),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

const ownerSchema = z.object({
  question_id: z.string(),
  answer: z.string(),
});

export const RecordOwnerAnswerTool: ToolDefinition<typeof ownerSchema> = {
  name: 'record_owner_answer',
  description: 'Record an owner answer for a review question in local control state.',
  schema: ownerSchema,
  handler: async ({ params }: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(
        gatewayOperations.record_owner_answer(paths, params.question_id, params.answer),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
};

const batchSchema = z.object({
  batch_id: z.string().optional(),
});

export const BuildApprovalBatchTool: ToolDefinition<typeof batchSchema> = {
  name: 'build_approval_batch',
  description:
    'Build a local approval batch proposal from classified rows. Does not apply to QuickBooks. apply_approved_batch is not available.',
  schema: batchSchema,
  handler: async ({ params }: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.build_approval_batch(paths, params.batch_id));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const ReconciliationStatusTool: ToolDefinition<typeof emptySchema> = {
  name: 'reconciliation_status',
  description:
    'Human-readable reconciliation / control-record status. Confirms apply_approved_batch is unavailable.',
  schema: emptySchema,
  handler: async (_args: any) => {
    try {
      const paths = initGateway(packageRootDir());
      return textResult(gatewayOperations.reconciliation_status(paths));
    } catch (error) {
      return errorResult(error);
    }
  },
};

export const DDT_FINANCE_GATEWAY_TOOLS = [
  ListFinancialSourcesTool,
  PullQboSnapshotTool,
  IngestStatementTool,
  DetectDuplicatesTool,
  MatchTransfersAndPaymentsTool,
  LinkPaymentTagsToQboIdsTool,
  ClassifyTransactionsTool,
  StageBillScanReviewTool,
  RecordOwnerAnswerTool,
  BuildApprovalBatchTool,
  ReconciliationStatusTool,
] as const;
