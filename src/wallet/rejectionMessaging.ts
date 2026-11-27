/**
 * Utilities for producing consistent user-facing messages when a wallet
 * prompt is declined.
 *
 * User rejection is an expected decision, not an error. It must never be
 * rendered as a generic failure, and the UI must never suggest automatic
 * resubmission.
 */

import { SorokitErrorCode } from "../shared/response";
import type { SorokitError } from "../shared/response";

const REJECTION_PATTERN = /reject|cancel|denied|declined/i;

/**
 * Returns true when the error represents a deliberate user rejection rather
 * than a transport or contract failure.
 */
export function isUserRejectionError(error: SorokitError): boolean {
  if (error.code === SorokitErrorCode.WALLET_SIGN_REJECTED) return true;
  if (
    error.code === SorokitErrorCode.WALLET_CONNECT_FAILED &&
    REJECTION_PATTERN.test(error.message)
  ) {
    return true;
  }
  return false;
}

/**
 * Maps a wallet error to the message shown to the user.
 *
 * - Sign rejections get a calm, actionable prompt with no suggestion of
 *   automatic retry.
 * - Connect rejections get a short next-step prompt.
 * - All other failures pass the original message through unchanged.
 */
export function walletErrorMessage(error: SorokitError): string {
  if (error.code === SorokitErrorCode.WALLET_SIGN_REJECTED) {
    return "You declined the transaction. When you're ready, press Send again to review and approve it.";
  }
  if (
    error.code === SorokitErrorCode.WALLET_CONNECT_FAILED &&
    REJECTION_PATTERN.test(error.message)
  ) {
    return "Connection declined. Select a wallet and try again.";
  }
  return error.message;
}
