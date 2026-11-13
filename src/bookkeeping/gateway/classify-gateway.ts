import { proposeClassification, ClassificationRule } from '../classification/rules-engine.js';
import { appendGatewayAudit } from './audit-log-file.js';
import {
  GatewayPaths,
  loadStatementRows,
  saveStatementRows,
} from './store.js';

export interface ClassifyGatewayResult {
  considered: number;
  proposed: number;
  skippedNonExpense: number;
  needsOwnerReview: number;
  blockedUntilMatch: number;
}

/**
 * Propose categories only after payments/transfers/refunds/duplicates are handled.
 */
export function classifyTransactions(
  paths: GatewayPaths,
  rules: ClassificationRule[],
): ClassifyGatewayResult {
  const rows = loadStatementRows(paths.statementsPath);
  let proposed = 0;
  let skippedNonExpense = 0;
  let needsOwnerReview = 0;
  let blockedUntilMatch = 0;
  let considered = 0;

  const next = rows.map((row) => {
    if (
      row.matchStatus === 'Payment' ||
      row.matchStatus === 'Transfer' ||
      row.matchStatus === 'Refund' ||
      row.matchStatus === 'DuplicateRow' ||
      row.matchStatus === 'DuplicateFile'
    ) {
      blockedUntilMatch += 1;
      return { ...row, proposedCategory: null };
    }

    considered += 1;
    const proposal = proposeClassification(
      {
        vendor: row.description,
        description: row.description,
        amount: row.amount ?? 0,
        hasItemEvidence: false,
        hasBusinessPurpose: false,
        vehicleEstablished: false,
        laneEstablished: false,
        isRefund: false,
      },
      rules,
    );

    if (proposal.action === 'IgnoreAsNonExpense') {
      skippedNonExpense += 1;
      return { ...row, proposedCategory: proposal.category, matchStatus: 'Payment' as const };
    }
    if (proposal.action === 'RequireOwnerReview' || !proposal.readyForAutoProposal) {
      needsOwnerReview += 1;
      return {
        ...row,
        proposedCategory: proposal.category,
        matchStatus: 'NeedsOwnerAnswer' as const,
      };
    }
    if (proposal.action === 'ProposeCategory' && proposal.category) {
      proposed += 1;
      return { ...row, proposedCategory: proposal.category, matchStatus: 'Possible' as const };
    }
    needsOwnerReview += 1;
    return { ...row, matchStatus: 'NeedsOwnerAnswer' as const };
  });

  saveStatementRows(paths.statementsPath, next);
  appendGatewayAudit(paths.auditLogPath, {
    action: 'classify_transactions',
    summary: 'Classification proposals written to local staging only',
    details: { considered, proposed, skippedNonExpense, needsOwnerReview, blockedUntilMatch },
  });

  return { considered, proposed, skippedNonExpense, needsOwnerReview, blockedUntilMatch };
}
