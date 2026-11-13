/**
 * Hard guards: write / apply paths must stay unavailable in the DDT Finance Gateway.
 */

export const GATEWAY_FORBIDDEN_ACTIONS = [
  'apply_approved_batch',
  'create_purchase',
  'update_purchase',
  'delete_purchase',
  'post_to_quickbooks',
  'reconcile_in_quickbooks',
  'bulk_reclassify',
] as const;

export type GatewayForbiddenAction = (typeof GATEWAY_FORBIDDEN_ACTIONS)[number];

export function assertWriteOperationsUnavailable(action: string): never {
  throw new Error(
    `DDT Finance Gateway refuses '${action}'. Write/post/reconcile/apply_approved_batch operations are unavailable.`,
  );
}

export function isWriteOperationAvailable(): false {
  return false;
}

export function listUnavailableWriteOperations(): readonly string[] {
  return GATEWAY_FORBIDDEN_ACTIONS;
}
