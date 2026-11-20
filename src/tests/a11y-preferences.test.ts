import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveStatusColor,
  STATUS_COLORS,
  motionSafeTransition,
  prefersReducedMotion,
  prefersHighContrast,
} from "../../examples/react-wallet-connect/src/a11y";

/**
 * Tests for the a11y utility module (#107).
 *
 * Covers reduced-motion helpers, contrast token resolution, and SSR safety.
 */

describe("resolveStatusColor", () => {
  it("returns default color when highContrast is false", () => {
    expect(resolveStatusColor("success", false)).toBe(STATUS_COLORS.success.default);
    expect(resolveStatusColor("error", false)).toBe(STATUS_COLORS.error.default);
    expect(resolveStatusColor("pending", false)).toBe(STATUS_COLORS.pending.default);
    expect(resolveStatusColor("neutral", false)).toBe(STATUS_COLORS.neutral.default);
  });

  it("returns highContrast color when highContrast is true", () => {
    expect(resolveStatusColor("success", true)).toBe(STATUS_COLORS.success.highContrast);
    expect(resolveStatusColor("error", true)).toBe(STATUS_COLORS.error.highContrast);
    expect(resolveStatusColor("pending", true)).toBe(STATUS_COLORS.pending.highContrast);
    expect(resolveStatusColor("neutral", true)).toBe(STATUS_COLORS.neutral.highContrast);
  });

  it("default colors are non-empty strings (not color-only — text accompanies them)", () => {
    for (const key of Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]) {
      expect(typeof STATUS_COLORS[key].default).toBe("string");
      expect(STATUS_COLORS[key].default.length).toBeGreaterThan(0);
    }
  });

  it("high-contrast colors use CSS system keywords (browser maps to user color scheme)", () => {
    for (const key of Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]) {
      // ButtonText is the standard forced-colors foreground keyword
      expect(STATUS_COLORS[key].highContrast).toBe("ButtonText");
    }
  });
});

describe("motionSafeTransition", () => {
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    globalThis.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    globalThis.matchMedia = originalMatchMedia;
  });

  it("returns the transition string when motion is not reduced", () => {
    (globalThis.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    expect(motionSafeTransition("opacity 0.3s ease")).toBe("opacity 0.3s ease");
  });

  it("returns 'none' when prefers-reduced-motion is active", () => {
    (globalThis.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    expect(motionSafeTransition("opacity 0.3s ease")).toBe("none");
  });

  it("returns 'none' for any transition string when motion is reduced", () => {
    (globalThis.matchMedia as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    expect(motionSafeTransition("transform 0.5s cubic-bezier(0.4,0,0.2,1)")).toBe("none");
  });
});

describe("prefersReducedMotion and prefersHighContrast — SSR safety", () => {
  it("returns false when window is undefined", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error intentional undefined window to simulate SSR
    delete globalThis.window;
    expect(prefersReducedMotion()).toBe(false);
    expect(prefersHighContrast()).toBe(false);
    globalThis.window = originalWindow;
  });
});
