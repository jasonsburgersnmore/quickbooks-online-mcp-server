import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appendGatewayAudit } from './audit-log-file.js';
import { loadBillScanReviews, saveBillScanReviews, type GatewayPaths } from './store.js';
import type { BillScanDocument, BillScanReview } from './types.js';

export interface StageBillScanInput {
  sourceFile: string;
  documents: BillScanDocument[];
}

export interface StageBillScanResult {
  accepted: boolean;
  duplicateOf: string | null;
  review: BillScanReview | null;
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateSourceFile(sourceFile: string): string {
  if (!path.isAbsolute(sourceFile)) {
    throw new Error('source_file must be an absolute path');
  }
  if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw new Error(`source_file does not exist or is not a file: ${sourceFile}`);
  }
  return path.resolve(sourceFile);
}

export function stageBillScanReview(
  paths: GatewayPaths,
  input: StageBillScanInput,
): StageBillScanResult {
  const sourceFile = validateSourceFile(input.sourceFile);
  if (input.documents.length === 0) {
    throw new Error('At least one reviewed document is required');
  }

  const sourceFileSha256 = sha256File(sourceFile);
  const reviews = loadBillScanReviews(paths.billScanReviewsPath);
  const duplicate = reviews.find((review) => review.sourceFileSha256 === sourceFileSha256);
  if (duplicate) {
    return { accepted: false, duplicateOf: duplicate.reviewId, review: null };
  }

  const review: BillScanReview = {
    reviewId: `scan-${sourceFileSha256.slice(0, 12)}`,
    sourceFile,
    sourceFileSha256,
    stagedAt: new Date().toISOString(),
    documents: input.documents,
    quickBooksWritePerformed: false,
    paymentPerformed: false,
  };
  saveBillScanReviews(paths.billScanReviewsPath, [...reviews, review]);
  appendGatewayAudit(paths.auditLogPath, {
    action: 'bill_scan_review_staged',
    summary: 'Mixed financial-document scan staged locally for owner review',
    details: {
      reviewId: review.reviewId,
      documentCount: review.documents.length,
      quickBooksWritePerformed: false,
      paymentPerformed: false,
    },
  });
  return { accepted: true, duplicateOf: null, review };
}
