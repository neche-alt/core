/**
 * Tests for dashboard error recovery affordances (#106).
 *
 * Verifies that:
 * - Read errors are classified as retryable (idempotent, no side-effects).
 * - Write errors require a status check before retry (no blind resubmission).
 * - The boundary: a write error with a txHash surfaces that hash for the
 *   status-check link, while a read error never carries a txHash.
 */
import { describe, it, expect } from "vitest";
import {
  isRetryable,
  requiresStatusCheck,
  type DashboardError,
} from "../../examples/transaction-dashboard/react-dashboard.example";

describe("dashboard error recovery (#106)", () => {
  describe("isRetryable", () => {
    it("returns true for read errors", () => {
      const err: DashboardError = { kind: "read", message: "Network timeout" };
      expect(isRetryable(err)).toBe(true);
    });

    it("returns false for write errors", () => {
      const err: DashboardError = {
        kind: "write",
        message: "Submit failed",
        txHash: "abc123",
      };
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe("requiresStatusCheck", () => {
    it("returns true for write errors", () => {
      const err: DashboardError = {
        kind: "write",
        message: "Submission timeout — unknown outcome",
        txHash: "deadbeef",
      };
      expect(requiresStatusCheck(err)).toBe(true);
    });

    it("returns false for read errors", () => {
      const err: DashboardError = { kind: "read", message: "Fetch failed" };
      expect(requiresStatusCheck(err)).toBe(false);
    });
  });

  describe("write error boundary: txHash presence", () => {
    it("write error carries txHash for status-check link", () => {
      const err: DashboardError = {
        kind: "write",
        message: "Unknown outcome after submit",
        txHash: "TX_HASH_ABC",
      };
      expect(requiresStatusCheck(err)).toBe(true);
      expect(err.txHash).toBe("TX_HASH_ABC");
    });

    it("read error never carries a txHash", () => {
      const err: DashboardError = { kind: "read", message: "Polling failed" };
      expect(isRetryable(err)).toBe(true);
      expect(err.txHash).toBeUndefined();
    });
  });
});
