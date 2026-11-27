import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  emitDeprecationWarning,
  deprecate,
  setDeprecationPolicy,
  getDeprecationPolicy,
  getEmittedDeprecationWarnings,
  clearDeprecationWarnings,
  formatDeprecationMessage,
} from "../shared/deprecation";

describe("Deprecation policy and runtime warning utilities (#69)", () => {
  beforeEach(() => {
    clearDeprecationWarnings();
    setDeprecationPolicy({ silenceWarnings: false, throwOnDeprecated: false });
    vi.restoreAllMocks();
  });

  describe("formatDeprecationMessage", () => {
    it("formats message with standard deprecation metadata", () => {
      const msg = formatDeprecationMessage({
        name: "legacyConnect",
        since: "0.2.0",
        removalVersion: "1.0.0",
        alternative: "client.wallet.connect",
      });

      expect(msg).toContain('[sorokit-core:DEPRECATED] "legacyConnect" is deprecated');
      expect(msg).toContain("since v0.2.0");
      expect(msg).toContain("and will be removed in v1.0.0.");
      expect(msg).toContain('Use "client.wallet.connect" instead.');
    });

    it("uses custom message when provided", () => {
      const msg = formatDeprecationMessage({
        name: "oldHook",
        message: "This hook is superseded by reactive stores.",
      });

      expect(msg).toBe("[sorokit-core:DEPRECATED] oldHook: This hook is superseded by reactive stores.");
    });
  });

  describe("emitDeprecationWarning", () => {
    it("emits console warning on first call and deduplicates subsequent calls", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const emittedFirst = emitDeprecationWarning({
        name: "testFeature",
        removalVersion: "2.0.0",
        alternative: "newFeature",
      });
      const emittedSecond = emitDeprecationWarning({
        name: "testFeature",
        removalVersion: "2.0.0",
        alternative: "newFeature",
      });

      expect(emittedFirst).toBe(true);
      expect(emittedSecond).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getEmittedDeprecationWarnings()).toEqual(["testFeature"]);
    });

    it("suppresses warnings when silenceWarnings is enabled", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      setDeprecationPolicy({ silenceWarnings: true });

      const emitted = emitDeprecationWarning({ name: "silencedFeature" });

      expect(emitted).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(getEmittedDeprecationWarnings()).toHaveLength(0);
    });

    it("throws error when throwOnDeprecated is enabled (strict CI mode)", () => {
      setDeprecationPolicy({ throwOnDeprecated: true });

      expect(() => {
        emitDeprecationWarning({
          name: "strictFeature",
          removalVersion: "1.0.0",
        });
      }).toThrow(/\[sorokit-core:DEPRECATED\] "strictFeature" is deprecated/);
    });
  });

  describe("deprecate function wrapper", () => {
    it("wraps function, emits deprecation warning on call, and preserves return value", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const originalAdd = (a: number, b: number) => a + b;
      const deprecatedAdd = deprecate(originalAdd, {
        name: "deprecatedAdd",
        removalVersion: "1.0.0",
        alternative: "math.add",
      });

      expect(deprecatedAdd(2, 3)).toBe(5);
      expect(deprecatedAdd(10, 20)).toBe(30);

      // Emitted once due to deduplication
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(getEmittedDeprecationWarnings()).toContain("deprecatedAdd");
    });

    it("preserves `this` context for class methods or object methods", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});

      const counter = {
        count: 10,
        increment(by: number) {
          this.count += by;
          return this.count;
        },
      };

      counter.increment = deprecate(counter.increment.bind(counter), {
        name: "counter.increment",
      });

      expect(counter.increment(5)).toBe(15);
      expect(counter.count).toBe(15);
    });
  });

  describe("policy management", () => {
    it("allows updating and reading policy options", () => {
      setDeprecationPolicy({ silenceWarnings: true, throwOnDeprecated: false });
      expect(getDeprecationPolicy()).toEqual({
        silenceWarnings: true,
        throwOnDeprecated: false,
      });
    });

    it("allows clearing warning cache to re-emit", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      emitDeprecationWarning({ name: "repeatFeature" });
      expect(warnSpy).toHaveBeenCalledTimes(1);

      clearDeprecationWarnings();
      expect(getEmittedDeprecationWarnings()).toHaveLength(0);

      emitDeprecationWarning({ name: "repeatFeature" });
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});
