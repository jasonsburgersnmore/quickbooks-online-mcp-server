/**
 * DDT Finance Gateway domain types (local staging only — no QBO writes).
 */

export type FinancialSourceKind =
  | 'qbo_direct_api'
  | 'bank_statement'
  | 'credit_card_statement'
  | 'cash_app'
  | 'amazon_orders'
  | 'mileage_export'
  | 'workbook_control'
  | 'other';

export type ScanDocumentKind =
  | 'vendor_bill'
  | 'utility_bill'
  | 'credit_card_statement'
  | 'bank_statement'
  | 'loan_statement'
  | 'compliance_notice'
  | 'other';

export type ScanDisposition =
  | 'ready_for_bill_entry'
  | 'statement_payment_due'
  | 'financing_record'
  | 'evidence_only'
  | 'review_hold'
  | 'needs_owner_answer';

export interface BillScanDocument {
  documentKind: ScanDocumentKind;
  disposition: ScanDisposition;
  vendorOrIssuer: string;
  documentDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  currentCharges: number | null;
  previousBalance: number | null;
  paymentsAndCredits: number | null;
  accountLast4: string | null;
  operatingLane: string | null;
  proposedAccount: string | null;
  businessPurpose: string | null;
  notes: string[];
}

export interface BillScanReview {
  reviewId: string;
  sourceFile: string;
  sourceFileSha256: string;
  stagedAt: string;
  documents: BillScanDocument[];
  quickBooksWritePerformed: false;
  paymentPerformed: false;
}

export type MatchStatus =
  | 'Unmatched'
  | 'Possible'
  | 'Matched'
  | 'DuplicateFile'
  | 'DuplicateRow'
  | 'Transfer'
  | 'Payment'
  | 'Refund'
  | 'NeedsOwnerAnswer';

export interface ControlRecordSnapshot {
  title: string;
  updatedAt: string;
  environmentNote: string;
  qboPurchaseLines: number;
  importedStatementRows: number;
  unmatchedOrPossibleRows: number;
  fullyMatchedRows: number;
  fingerprintFirst: boolean;
  matchBeforeClassify: boolean;
  notes: string[];
}

export interface FileFingerprint {
  path: string;
  sha256: string;
  byteLength: number;
  ingestedAt: string | null;
  duplicateOf: string | null;
}

export interface StatementRow {
  rowId: string;
  sourceFileSha256: string;
  txnDate: string | null;
  amount: number | null;
  description: string;
  raw: Record<string, string>;
  matchStatus: MatchStatus;
  matchedQboId: string | null;
  proposedCategory: string | null;
}

export interface OwnerAnswer {
  questionId: string;
  answer: string;
  recordedAt: string;
}

export interface GatewayAuditEvent {
  id: string;
  timestamp: string;
  action: string;
  summary: string;
  /** Never include secrets, tokens, or full account numbers. */
  details: Record<string, string | number | boolean | null>;
}

export interface ReconciliationStatus {
  control: ControlRecordSnapshot;
  fingerprints: number;
  statementRows: number;
  byMatchStatus: Record<string, number>;
  ownerAnswers: number;
  approvalBatches: number;
  applyApprovedBatchAvailable: false;
}
