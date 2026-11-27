import { describe, it, expect } from "vitest";
import { isUserRejectionError, walletErrorMessage } from "./rejectionMessaging";
import { SorokitErrorCode, SorokitErrorCategory } from "../shared/response";
import type { SorokitError } from "../shared/response";

function makeError(
  code: SorokitErrorCode,
  message: string,
  category: SorokitErrorCategory = SorokitErrorCategory.WALLET,
): SorokitError {
  return { code, message, category, recovery: { retryable: false, action: "" } };
}

describe("isUserRejectionError", () => {
  it("returns true for WALLET_SIGN_REJECTED", () => {
    expect(
      isUserRejectionError(makeError(SorokitErrorCode.WALLET_SIGN_REJECTED, "User rejected")),
    ).toBe(true);
  });

  it("returns true for WALLET_CONNECT_FAILED with 'declined' in message", () => {
    expect(
      isUserRejectionError(
        makeError(SorokitErrorCode.WALLET_CONNECT_FAILED, "User declined the connection"),
      ),
    ).toBe(true);
  });

  it("returns true for WALLET_CONNECT_FAILED with 'denied' in message", () => {
    expect(
      isUserRejectionError(
        makeError(SorokitErrorCode.WALLET_CONNECT_FAILED, "Permission denied"),
      ),
    ).toBe(true);
  });

  it("returns false for WALLET_CONNECT_FAILED without rejection keyword", () => {
    expect(
      isUserRejectionError(
        makeError(SorokitErrorCode.WALLET_CONNECT_FAILED, "Extension not found"),
      ),
    ).toBe(false);
  });

  it("returns false for transport errors", () => {
    expect(
      isUserRejectionError(
        makeError(SorokitErrorCode.NETWORK_ERROR, "fetch failed", SorokitErrorCategory.NETWORK),
      ),
    ).toBe(false);
  });

  it("returns false for contract errors", () => {
    expect(
      isUserRejectionError(
        makeError(
          SorokitErrorCode.CONTRACT_INVOKE_FAILED,
          "simulation error",
          SorokitErrorCategory.CONTRACT,
        ),
      ),
    ).toBe(false);
  });
});

describe("walletErrorMessage", () => {
  it("returns a calm next-action prompt for WALLET_SIGN_REJECTED", () => {
    const msg = walletErrorMessage(
      makeError(SorokitErrorCode.WALLET_SIGN_REJECTED, "rejected"),
    );
    expect(msg).toContain("declined");
    expect(msg).toContain("press Send again");
    expect(msg).not.toMatch(/auto|automatic/i);
  });

  it("does not suggest resubmission for sign rejections", () => {
    const msg = walletErrorMessage(
      makeError(SorokitErrorCode.WALLET_SIGN_REJECTED, "rejected"),
    );
    expect(msg).not.toMatch(/resubmit|automatically|auto.retry/i);
  });

  it("returns a connection-declined prompt for a rejected WALLET_CONNECT_FAILED", () => {
    const msg = walletErrorMessage(
      makeError(SorokitErrorCode.WALLET_CONNECT_FAILED, "User denied"),
    );
    expect(msg).toContain("declined");
    expect(msg).toContain("try again");
  });

  it("passes through the original message for non-rejection failures", () => {
    const original = "Signing failed: timeout";
    expect(
      walletErrorMessage(makeError(SorokitErrorCode.WALLET_SIGN_FAILED, original)),
    ).toBe(original);
  });

  it("passes through the original message for network errors", () => {
    const original = "fetch failed";
    expect(
      walletErrorMessage(
        makeError(SorokitErrorCode.NETWORK_ERROR, original, SorokitErrorCategory.NETWORK),
      ),
    ).toBe(original);
  });
});
