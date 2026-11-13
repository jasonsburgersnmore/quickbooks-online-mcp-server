import { OperatingLane, VehicleCostCategory } from '../types.js';

export type ClassificationAction =
  | 'ProposeCategory'
  | 'RequireOwnerReview'
  | 'IgnoreAsNonExpense'
  | 'FollowOriginalRefund';

export interface ClassificationRule {
  id: string;
  enabled: boolean;
  priority: number;
  vendorPattern: string; // case-insensitive substring or regex:/.../i
  descriptionContains?: string;
  proposedCategory?: VehicleCostCategory | string;
  proposedLane?: OperatingLane;
  action: ClassificationAction;
  requiresVehicle: boolean;
  requiresLane: boolean;
  requiresItemEvidence: boolean;
  requiresBusinessPurpose: boolean;
  autoPromoteAfterApprovals: number;
  approvalCount: number;
  notes: string;
}

export interface ClassificationInput {
  vendor: string;
  description: string;
  amount: number;
  hasItemEvidence: boolean;
  hasBusinessPurpose: boolean;
  vehicleEstablished: boolean;
  laneEstablished: boolean;
  isRefund: boolean;
  originalCategory?: string;
}

export interface ClassificationProposal {
  action: ClassificationAction;
  category: string | null;
  operatingLane: OperatingLane | null;
  confidence: 'High' | 'Medium' | 'Low';
  ruleId: string | null;
  reasons: string[];
  readyForAutoProposal: boolean;
}

function matchesPattern(text: string, pattern: string): boolean {
  const hay = text.toLowerCase();
  if (pattern.startsWith('regex:')) {
    const body = pattern.slice('regex:'.length);
    const lastSlash = body.lastIndexOf('/');
    if (body.startsWith('/') && lastSlash > 0) {
      const source = body.slice(1, lastSlash);
      const flags = body.slice(lastSlash + 1) || 'i';
      return new RegExp(source, flags).test(text);
    }
    return new RegExp(body, 'i').test(text);
  }
  return hay.includes(pattern.toLowerCase());
}

/**
 * Narrow card-balance payment detector.
 * Merchant charges on a credit-card statement (fuel, repairs, meals, etc.) remain
 * expenses or asset candidates. Only bank settlements that pay down the card balance
 * (e.g. "ONLINE ACH PAYMENT THANK YOU") are non-expense payments/transfers.
 * Never classify based merely on the words "credit card".
 */
export function isCreditCardBalancePayment(input: ClassificationInput): boolean {
  const t = `${input.vendor} ${input.description}`.toLowerCase().replace(/\s+/g, ' ').trim();
  // Exact / near-exact settlement descriptors used on credit-card statement lines.
  if (/\bonline\s+ach\s+payment(\s+thank\s+you)?\b/.test(t)) return true;
  if (/\bach\s+payment\s+thank\s+you\b/.test(t)) return true;
  // Bank-side wording sometimes omits ACH; require positive amount (payment/credit side).
  if (/\bonline\s+payment\s+thank\s+you\b/.test(t) && input.amount > 0) return true;
  if (/\bautopay\b/.test(t) && /\b(payment|thank you)\b/.test(t) && input.amount > 0) return true;
  return false;
}

const HARD_CODED_GUARDS: Array<(input: ClassificationInput) => ClassificationProposal | null> = [
  (input) => {
    if (isCreditCardBalancePayment(input)) {
      return {
        action: 'IgnoreAsNonExpense',
        category: 'Credit-card balance payment / transfer',
        operatingLane: null,
        confidence: 'High',
        ruleId: 'guard-cc-balance-payment',
        reasons: [
          'Only card-balance settlements (e.g. ONLINE ACH PAYMENT THANK YOU) are payments/transfers — not expenses',
          'Merchant card charges (fuel, repairs, software, meals, lodging, equipment) remain expenses or asset candidates',
          'Never apply this rule based merely on the words "credit card"',
          'Before posting a payment: require matching amount, date/date window, source bank account, and card-liability destination',
        ],
        readyForAutoProposal: true,
      };
    }
    return null;
  },
  (input) => {
    if (input.isRefund && input.originalCategory) {
      return {
        action: 'FollowOriginalRefund',
        category: input.originalCategory,
        operatingLane: null,
        confidence: 'High',
        ruleId: 'guard-refund-follow-original',
        reasons: ['Refunds must follow the original transaction category'],
        readyForAutoProposal: true,
      };
    }
    return null;
  },
  (input) => {
    const t = `${input.vendor} ${input.description}`.toLowerCase();
    if (/\b(atm|withdrawal|cash app cash out|cash withdrawal)\b/.test(t)) {
      return {
        action: 'RequireOwnerReview',
        category: null,
        operatingLane: 'Personal/Owner',
        confidence: 'Low',
        ruleId: 'guard-cash-withdrawal',
        reasons: ['Cash withdrawals require owner purpose documentation'],
        readyForAutoProposal: false,
      };
    }
    return null;
  },
];

/**
 * Propose a classification using editable rules + hard safety guards.
 * Merchant name alone never authorizes posting (readyForAutoProposal requires evidence gates).
 */
export function proposeClassification(
  input: ClassificationInput,
  rules: ClassificationRule[],
): ClassificationProposal {
  for (const guard of HARD_CODED_GUARDS) {
    const hit = guard(input);
    if (hit) return hit;
  }

  const sorted = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const hay = `${input.vendor} ${input.description}`;
  for (const rule of sorted) {
    if (!matchesPattern(input.vendor, rule.vendorPattern) && !matchesPattern(hay, rule.vendorPattern)) {
      continue;
    }
    if (rule.descriptionContains && !matchesPattern(input.description, rule.descriptionContains)) {
      continue;
    }

    const reasons: string[] = [`Matched rule ${rule.id}`];
    let confidence: 'High' | 'Medium' | 'Low' = 'Medium';
    let ready = rule.approvalCount >= rule.autoPromoteAfterApprovals && rule.autoPromoteAfterApprovals > 0;

    if (rule.requiresItemEvidence && !input.hasItemEvidence) {
      return {
        action: 'RequireOwnerReview',
        category: rule.proposedCategory ?? null,
        operatingLane: rule.proposedLane ?? null,
        confidence: 'Low',
        ruleId: rule.id,
        reasons: [...reasons, 'Mixed retailer / item evidence required'],
        readyForAutoProposal: false,
      };
    }
    if (rule.requiresBusinessPurpose && !input.hasBusinessPurpose) {
      return {
        action: 'RequireOwnerReview',
        category: rule.proposedCategory ?? null,
        operatingLane: rule.proposedLane ?? null,
        confidence: 'Low',
        ruleId: rule.id,
        reasons: [...reasons, 'Meals/business purpose documentation required'],
        readyForAutoProposal: false,
      };
    }
    if (rule.requiresVehicle && !input.vehicleEstablished) {
      reasons.push('Category may propose, but vehicle still required');
      confidence = 'Medium';
      ready = false;
    }
    if (rule.requiresLane && !input.laneEstablished) {
      reasons.push('Operating lane still required');
      confidence = 'Medium';
      ready = false;
    }

    if (rule.action === 'RequireOwnerReview') {
      return {
        action: 'RequireOwnerReview',
        category: rule.proposedCategory ?? null,
        operatingLane: rule.proposedLane ?? null,
        confidence: 'Low',
        ruleId: rule.id,
        reasons,
        readyForAutoProposal: false,
      };
    }

    if (confidence === 'Medium' && input.vehicleEstablished && input.laneEstablished) {
      confidence = 'High';
    }

    // Merchant name alone never authorizes posting.
    if (!input.vehicleEstablished && rule.requiresVehicle) {
      ready = false;
    }

    return {
      action: rule.action,
      category: rule.proposedCategory ?? null,
      operatingLane: rule.proposedLane ?? null,
      confidence,
      ruleId: rule.id,
      reasons,
      readyForAutoProposal: ready,
    };
  }

  return {
    action: 'RequireOwnerReview',
    category: null,
    operatingLane: null,
    confidence: 'Low',
    ruleId: null,
    reasons: ['No strong rule match; owner review required'],
    readyForAutoProposal: false,
  };
}

/** Record an owner approval toward auto-promotion of a rule. */
export function recordRuleApproval(rule: ClassificationRule): ClassificationRule {
  return { ...rule, approvalCount: rule.approvalCount + 1 };
}
