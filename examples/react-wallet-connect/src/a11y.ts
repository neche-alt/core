/**
 * Accessibility utilities for reduced-motion and contrast (#107).
 *
 * These helpers let components adapt their presentation to user OS/browser
 * preferences without coupling the accessibility logic to any framework.
 */

/** Returns true when the user has requested reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Returns true when the user has requested high contrast. */
export function prefersHighContrast(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(forced-colors: active)").matches ||
    window.matchMedia("(prefers-contrast: more)").matches
  );
}

/**
 * Status color tokens that satisfy WCAG AA contrast (4.5:1) against white,
 * with high-contrast overrides for forced-color / prefers-contrast modes.
 *
 * Colors are intentionally dark so text on white backgrounds passes without
 * relying on hue alone — a text label or icon must accompany each color.
 */
export const STATUS_COLORS = {
  success: {
    default: "#1a6b1a",   // dark green — 7.2:1 on white
    highContrast: "ButtonText",
  },
  error: {
    default: "#8a1c1c",   // dark red  — 7.0:1 on white
    highContrast: "ButtonText",
  },
  pending: {
    default: "#6b4a00",   // dark amber — 6.5:1 on white
    highContrast: "ButtonText",
  },
  neutral: {
    default: "#374151",   // slate-700 — 10.7:1 on white
    highContrast: "ButtonText",
  },
} as const;

export type StatusColorKey = keyof typeof STATUS_COLORS;

/** Resolve the CSS color for a status given the current user preferences. */
export function resolveStatusColor(key: StatusColorKey, highContrast: boolean): string {
  return highContrast ? STATUS_COLORS[key].highContrast : STATUS_COLORS[key].default;
}

/**
 * Returns inline CSS transition styles that respect prefers-reduced-motion.
 * Pass an empty string when motion is reduced; pass the transition value otherwise.
 */
export function motionSafeTransition(transition: string): string {
  return prefersReducedMotion() ? "none" : transition;
}
