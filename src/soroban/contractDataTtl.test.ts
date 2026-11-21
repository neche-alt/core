import { describe, it, expect } from "vitest";
import {
  classifyContractDataTtl,
  buildContractDataTtlResult,
  readContractDataWithTtl,
  shouldRenewContractData,
} from "./contractDataTtl";

const CURRENT_LEDGER = 50_000;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_PRESENT = { latestLedger: CURRENT_LEDGER, liveUntilLedgerSeq: 51_000 };
const FIXTURE_EXPIRED = { latestLedger: CURRENT_LEDGER, liveUntilLedgerSeq: 49_999 };
const FIXTURE_EXACTLY_AT_BOUNDARY = { latestLedger: CURRENT_LEDGER, liveUntilLedgerSeq: CURRENT_LEDGER };
const FIXTURE_MISSING = { latestLedger: CURRENT_LEDGER, liveUntilLedgerSeq: undefined };

// ─── classifyContractDataTtl ──────────────────────────────────────────────────

describe("classifyContractDataTtl", () => {
  it("classifies a live entry as present", () => {
    expect(classifyContractDataTtl(FIXTURE_PRESENT.latestLedger, FIXTURE_PRESENT.liveUntilLedgerSeq))
      .toBe("present");
  });

  it("classifies an expired entry as expired", () => {
    expect(classifyContractDataTtl(FIXTURE_EXPIRED.latestLedger, FIXTURE_EXPIRED.liveUntilLedgerSeq))
      .toBe("expired");
  });

  it("classifies entry expiring at current ledger as expired (boundary)", () => {
    expect(classifyContractDataTtl(
      FIXTURE_EXACTLY_AT_BOUNDARY.latestLedger,
      FIXTURE_EXACTLY_AT_BOUNDARY.liveUntilLedgerSeq,
    )).toBe("expired");
  });

  it("classifies missing entry (undefined liveUntilLedgerSeq) as missing", () => {
    expect(classifyContractDataTtl(FIXTURE_MISSING.latestLedger, FIXTURE_MISSING.liveUntilLedgerSeq))
      .toBe("missing");
  });
});

// ─── buildContractDataTtlResult ───────────────────────────────────────────────

describe("buildContractDataTtlResult", () => {
  it("present fixture: remainingLedgers is positive", () => {
    const result = buildContractDataTtlResult(
      FIXTURE_PRESENT.latestLedger,
      FIXTURE_PRESENT.liveUntilLedgerSeq,
    );
    expect(result.ttlState).toBe("present");
    expect(result.remainingLedgers).toBe(1_000);
    expect(result.liveUntilLedgerSeq).toBe(51_000);
    expect(result.latestLedger).toBe(CURRENT_LEDGER);
  });

  it("expired fixture: remainingLedgers is 0", () => {
    const result = buildContractDataTtlResult(
      FIXTURE_EXPIRED.latestLedger,
      FIXTURE_EXPIRED.liveUntilLedgerSeq,
    );
    expect(result.ttlState).toBe("expired");
    expect(result.remainingLedgers).toBe(0);
  });

  it("missing fixture: liveUntilLedgerSeq and remainingLedgers are undefined", () => {
    const result = buildContractDataTtlResult(
      FIXTURE_MISSING.latestLedger,
      FIXTURE_MISSING.liveUntilLedgerSeq,
    );
    expect(result.ttlState).toBe("missing");
    expect(result.liveUntilLedgerSeq).toBeUndefined();
    expect(result.remainingLedgers).toBeUndefined();
  });
});

// ─── readContractDataWithTtl ──────────────────────────────────────────────────

describe("readContractDataWithTtl", () => {
  it("present entry returns ok without options", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, 51_000);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.ttlState).toBe("present");
    }
  });

  it("expired entry returns ok by default (no errorOnExpired)", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, 49_999);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.ttlState).toBe("expired");
    }
  });

  it("expired entry returns error when errorOnExpired is true", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, 49_999, { errorOnExpired: true });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toMatch(/expired/i);
    }
  });

  it("missing entry returns ok by default (no errorOnMissing)", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, undefined);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.ttlState).toBe("missing");
    }
  });

  it("missing entry returns error when errorOnMissing is true", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, undefined, { errorOnMissing: true });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toMatch(/missing/i);
    }
  });

  it("present entry is not affected by errorOnExpired or errorOnMissing", () => {
    const result = readContractDataWithTtl(CURRENT_LEDGER, 51_000, {
      errorOnExpired: true,
      errorOnMissing: true,
    });
    expect(result.status).toBe("ok");
  });
});

// ─── shouldRenewContractData ──────────────────────────────────────────────────

describe("shouldRenewContractData", () => {
  it("returns true when remaining ledgers are below threshold", () => {
    expect(shouldRenewContractData(50, 100)).toBe(true);
  });

  it("returns true when remaining ledgers equal the threshold", () => {
    expect(shouldRenewContractData(100, 100)).toBe(true);
  });

  it("returns false when remaining ledgers exceed the threshold", () => {
    expect(shouldRenewContractData(101, 100)).toBe(false);
  });

  it("returns true for already-expired entry (0 remaining)", () => {
    expect(shouldRenewContractData(0)).toBe(true);
  });

  it("uses default threshold of 100", () => {
    expect(shouldRenewContractData(99)).toBe(true);
    expect(shouldRenewContractData(101)).toBe(false);
  });
});
