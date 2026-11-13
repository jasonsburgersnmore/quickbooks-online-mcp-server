/** Shared bookkeeping domain types for multi-lane business operations. */

export const OPERATING_LANES = [
  'Construction',
  'Dump-Truck Hauling',
  'Vacation Rental',
  'Personal/Owner',
  'Other/Unknown',
] as const;

export type OperatingLane = (typeof OPERATING_LANES)[number];

export const REVIEW_STATUSES = [
  'Imported',
  'NeedsReview',
  'Approved',
  'Rejected',
  'ReadyToPost',
  'Posted',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const VEHICLE_COST_CATEGORIES = [
  'Fuel',
  'DEF',
  'Repairs',
  'PreventiveMaintenance',
  'Tires',
  'Insurance',
  'RegistrationPermits',
  'TollsParking',
  'TruckWashes',
  'LoanPrincipal',
  'Interest',
  'FixedAssetPurchase',
  'PersonalExpense',
  'OtherOperating',
] as const;

export type VehicleCostCategory = (typeof VEHICLE_COST_CATEGORIES)[number];

/** Categories that are not operating expenses. */
export const NON_OPERATING_COST_CATEGORIES: ReadonlySet<VehicleCostCategory> = new Set([
  'LoanPrincipal',
  'FixedAssetPurchase',
  'PersonalExpense',
]);

export interface MileageTrip {
  tripKey: string;
  tripDate: string;
  vehicle: string;
  driver: string;
  startOdometer: number | null;
  endOdometer: number | null;
  totalMiles: number;
  businessMiles: number;
  personalMiles: number;
  paidMiles: number;
  deadheadMiles: number;
  operatingLane: OperatingLane;
  customerJob: string;
  tripPurpose: string;
  origin: string;
  destination: string;
  loads: number | null;
  tonsHauled: number | null;
  source: string;
  sourceIdentifier: string;
  evidence: string;
  reviewStatus: ReviewStatus;
}

export interface VehicleExpense {
  expenseId: string;
  txnDate: string;
  vehicle: string | null;
  amount: number;
  category: VehicleCostCategory;
  operatingLane: OperatingLane;
  vendor: string;
  qboTransactionId: string | null;
  gallons: number | null;
  isAssigned: boolean;
  evidence: string;
}

export interface TripRevenue {
  tripKey: string;
  revenueAmount: number;
}
