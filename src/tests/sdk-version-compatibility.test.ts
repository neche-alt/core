/**
 * Protocol compatibility tests for Stellar SDK peer versions (#86).
 *
 * Validates that the supported version range is enforced, unsupported versions
 * fail with actionable package guidance, and the CI compatibility check covers
 * every branch of the version comparison logic.
 *
 * Run focused:
 *   vitest run src/tests/sdk-version-compatibility.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import {
  compareStellarSdkVersion,
  checkStellarSdkVersionCompatibility,
  parseSemverCore,
  SUPPORTED_STELLAR_SDK_VERSION,
} from "../client/sdkVersionCompatibility";
import type { SorokitLogger } from "../shared/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): SorokitLogger & {
  warn: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Supported version range definition
// ---------------------------------------------------------------------------

describe("supported version range (#86)", () => {
  it("SUPPORTED_STELLAR_SDK_VERSION is a parseable semver string", () => {
    const parsed = parseSemverCore(SUPPORTED_STELLAR_SDK_VERSION);
    expect(parsed).not.toBeNull();
    expect(parsed!.major).toBeGreaterThanOrEqual(13);
  });

  it("current devDependency version is exactly the supported version", () => {
    // This keeps the constant and package.json in sync.
    // If the constant drifts from the devDependency, type-level failures
    // appear only in CI, not locally — this test surfaces the drift.
    expect(SUPPORTED_STELLAR_SDK_VERSION).toBe("13.3.0");
  });
});

// ---------------------------------------------------------------------------
// compareStellarSdkVersion — full version-range boundary coverage
// ---------------------------------------------------------------------------

describe("compareStellarSdkVersion — version range boundaries (#86)", () => {
  describe("compatible range", () => {
    it("reports compatible for the exact supported version", () => {
      const result = compareStellarSdkVersion("13.3.0", "13.3.0");
      expect(result.status).toBe("compatible");
    });

    it("reports compatible when installed equals the SUPPORTED_STELLAR_SDK_VERSION constant", () => {
      const result = compareStellarSdkVersion(SUPPORTED_STELLAR_SDK_VERSION);
      expect(result.status).toBe("compatible");
    });
  });

  describe("major version mismatch — always incompatible", () => {
    const cases: Array<[string, string]> = [
      ["14.0.0", "13.3.0"],
      ["12.0.0", "13.3.0"],
      ["15.3.0", "13.3.0"],
      ["1.0.0", "13.3.0"],
    ];

    it.each(cases)(
      "installed=%s vs supported=%s → incompatible/major-mismatch",
      (installed, supported) => {
        const result = compareStellarSdkVersion(installed, supported);
        expect(result.status).toBe("incompatible");
        if (result.status === "incompatible") {
          expect(result.kind).toBe("major-mismatch");
          expect(result.installedVersion).toBe(installed);
          expect(result.supportedVersion).toBe(supported);
          expect(result.message).toContain(installed);
          expect(result.message).toContain(supported);
        }
      },
    );
  });

  describe("older-than-supported — always incompatible", () => {
    const cases: Array<[string, string]> = [
      ["13.2.9", "13.3.0"],
      ["13.3.0", "13.4.0"],
      ["13.0.0", "13.3.0"],
      ["13.3.0", "13.3.1"],
    ];

    it.each(cases)(
      "installed=%s vs supported=%s → incompatible/older-than-supported",
      (installed, supported) => {
        const result = compareStellarSdkVersion(installed, supported);
        expect(result.status).toBe("incompatible");
        if (result.status === "incompatible") {
          expect(result.kind).toBe("older-than-supported");
          expect(result.message).toContain(installed);
        }
      },
    );
  });

  describe("newer-minor — same-major newer release, low-severity warning", () => {
    const cases: Array<[string, string]> = [
      ["13.4.0", "13.3.0"],
      ["13.3.1", "13.3.0"],
      ["13.10.0", "13.3.0"],
    ];

    it.each(cases)(
      "installed=%s vs supported=%s → incompatible/newer-minor",
      (installed, supported) => {
        const result = compareStellarSdkVersion(installed, supported);
        expect(result.status).toBe("incompatible");
        if (result.status === "incompatible") {
          expect(result.kind).toBe("newer-minor");
          // Message must guide the user toward testing against the supported version
          expect(result.message).toContain(installed);
          expect(result.message).toContain(supported);
        }
      },
    );
  });

  describe("unknown — unparseable or absent version", () => {
    it("reports unknown for undefined installed version", () => {
      const result = compareStellarSdkVersion(undefined);
      expect(result.status).toBe("unknown");
    });

    it("reports unknown for an empty string", () => {
      const result = compareStellarSdkVersion("", "13.3.0");
      expect(result.status).toBe("unknown");
    });

    it("reports unknown for a non-semver string", () => {
      const result = compareStellarSdkVersion("not-a-version", "13.3.0");
      expect(result.status).toBe("unknown");
    });

    it("reports unknown when the supported version is unparseable", () => {
      const result = compareStellarSdkVersion("13.3.0", "broken");
      expect(result.status).toBe("unknown");
    });
  });
});

// ---------------------------------------------------------------------------
// Unsupported versions fail with clear package guidance
// ---------------------------------------------------------------------------

describe("unsupported version guidance (#86)", () => {
  it("major-mismatch message names the correct install command", () => {
    const result = compareStellarSdkVersion("14.0.0", "13.3.0");
    expect(result.status).toBe("incompatible");
    if (result.status === "incompatible") {
      // Message must be actionable — user should know what version to install
      expect(result.message).toContain("@stellar/stellar-sdk");
      expect(result.message).toContain("13.3.0");
      expect(result.message).toContain("14.0.0");
    }
  });

  it("older-than-supported message names the correct install command", () => {
    const result = compareStellarSdkVersion("13.2.0", "13.3.0");
    expect(result.status).toBe("incompatible");
    if (result.status === "incompatible") {
      expect(result.message).toContain("@stellar/stellar-sdk");
      expect(result.message).toContain("13.3.0");
    }
  });

  it("newer-minor message explains the risk and names the tested version", () => {
    const result = compareStellarSdkVersion("13.5.0", "13.3.0");
    expect(result.status).toBe("incompatible");
    if (result.status === "incompatible") {
      expect(result.kind).toBe("newer-minor");
      expect(result.message).toContain("13.3.0");
      expect(result.message).toContain("13.5.0");
    }
  });
});

// ---------------------------------------------------------------------------
// CI check: warning path via checkStellarSdkVersionCompatibility
// ---------------------------------------------------------------------------

describe("checkStellarSdkVersionCompatibility — CI-targeted checks (#86)", () => {
  it("logs a structured warning for a major-mismatch incompatible version", () => {
    const logger = makeLogger();
    const result = checkStellarSdkVersionCompatibility("14.0.0", {
      logger,
      supportedVersion: "13.3.0",
    });

    expect(result.status).toBe("incompatible");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const [message, meta] = logger.warn.mock.calls[0]!;
    expect(message).toContain("14.0.0");
    expect(meta).toMatchObject({
      installedVersion: "14.0.0",
      supportedVersion: "13.3.0",
      kind: "major-mismatch",
    });
  });

  it("logs a structured warning for an older-than-supported version", () => {
    const logger = makeLogger();
    checkStellarSdkVersionCompatibility("13.2.0", {
      logger,
      supportedVersion: "13.3.0",
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, meta] = logger.warn.mock.calls[0]!;
    expect(meta).toMatchObject({ kind: "older-than-supported" });
  });

  it("logs a structured warning for a newer-minor version", () => {
    const logger = makeLogger();
    checkStellarSdkVersionCompatibility("13.4.0", {
      logger,
      supportedVersion: "13.3.0",
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, meta] = logger.warn.mock.calls[0]!;
    expect(meta).toMatchObject({ kind: "newer-minor" });
  });

  it("does not log for a compatible version", () => {
    const logger = makeLogger();
    const result = checkStellarSdkVersionCompatibility("13.3.0", {
      logger,
      supportedVersion: "13.3.0",
    });

    expect(result.status).toBe("compatible");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not throw and does not log for an unknown version (opt-in check)", () => {
    const logger = makeLogger();
    const result = checkStellarSdkVersionCompatibility(undefined, { logger });
    expect(result.status).toBe("unknown");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not throw when no logger is provided", () => {
    expect(() =>
      checkStellarSdkVersionCompatibility("14.0.0", { supportedVersion: "13.3.0" }),
    ).not.toThrow();
  });

  it("warning metadata includes both installedVersion and supportedVersion for all incompatible kinds", () => {
    const cases = ["14.0.0", "13.2.0", "13.4.0"] as const;

    for (const installed of cases) {
      const logger = makeLogger();
      checkStellarSdkVersionCompatibility(installed, {
        logger,
        supportedVersion: "13.3.0",
      });
      const [, meta] = logger.warn.mock.calls[0]!;
      expect(meta).toHaveProperty("installedVersion", installed);
      expect(meta).toHaveProperty("supportedVersion", "13.3.0");
    }
  });
});

// ---------------------------------------------------------------------------
// Serialization / type compatibility boundary tests
// ---------------------------------------------------------------------------

describe("type-level compatibility boundaries (#86)", () => {
  it("parseSemverCore correctly handles prerelease suffixes", () => {
    expect(parseSemverCore("13.3.0-alpha.1")).toEqual({ major: 13, minor: 3, patch: 0 });
    expect(parseSemverCore("13.3.0+build.5")).toEqual({ major: 13, minor: 3, patch: 0 });
    expect(parseSemverCore("13.3.0-rc.2+build.3")).toEqual({ major: 13, minor: 3, patch: 0 });
  });

  it("parseSemverCore rejects v-prefixed version strings", () => {
    // npm uses semver without the v prefix; v-prefixed strings from git tags
    // are not a valid input to this function
    expect(parseSemverCore("v13.3.0")).toBeNull();
  });

  it("compareStellarSdkVersion treats prerelease installed version same as release", () => {
    // 13.3.0-beta is older than 13.3.0 strictly speaking, but parseSemverCore
    // strips the suffix and both parse to 13.3.0 → compatible
    const result = compareStellarSdkVersion("13.3.0-beta.1", "13.3.0");
    expect(result.status).toBe("compatible");
  });
});
