/**
 * Release deprecation policy utilities and runtime warning dispatch.
 *
 * Provides structured helpers for announcing deprecation lifecycles, emitting
 * deduplicated runtime warnings, and wrapping legacy APIs with migration guidance.
 */

export interface DeprecationWarningOptions {
  name: string;
  since?: string;
  removalVersion?: string;
  alternative?: string;
  message?: string;
}

export interface DeprecationPolicyOptions {
  silenceWarnings?: boolean;
  throwOnDeprecated?: boolean;
}

let policyOptions: DeprecationPolicyOptions = {
  silenceWarnings: typeof process !== "undefined" && process.env?.SOROKIT_DISABLE_DEPRECATION_WARNINGS === "1",
  throwOnDeprecated: false,
};

const emittedWarnings = new Set<string>();

/**
 * Configure global deprecation policy behavior.
 */
export function setDeprecationPolicy(options: DeprecationPolicyOptions): void {
  policyOptions = { ...policyOptions, ...options };
}

/**
 * Get current deprecation policy settings.
 */
export function getDeprecationPolicy(): Readonly<DeprecationPolicyOptions> {
  return policyOptions;
}

/**
 * Formats a standardized deprecation message.
 */
export function formatDeprecationMessage(options: DeprecationWarningOptions): string {
  if (options.message) {
    return `[sorokit-core:DEPRECATED] ${options.name}: ${options.message}`;
  }

  const parts = [`[sorokit-core:DEPRECATED] "${options.name}" is deprecated`];
  if (options.since) {
    parts.push(`since v${options.since}`);
  }
  if (options.removalVersion) {
    parts.push(`and will be removed in v${options.removalVersion}`);
  }
  parts.push(".");
  if (options.alternative) {
    parts.push(` Use "${options.alternative}" instead.`);
  }

  return parts.join(" ").replace(/\s+\./g, ".");
}

/**
 * Emit a deduplicated deprecation warning to console.warn.
 */
export function emitDeprecationWarning(options: DeprecationWarningOptions): boolean {
  if (policyOptions.silenceWarnings) {
    return false;
  }

  const key = options.name;
  if (emittedWarnings.has(key)) {
    return false;
  }

  emittedWarnings.add(key);
  const formatted = formatDeprecationMessage(options);

  if (policyOptions.throwOnDeprecated) {
    throw new Error(formatted);
  }

  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(formatted);
  }

  return true;
}

/**
 * Wraps a deprecated function with runtime deprecation warning dispatch.
 */
export function deprecate<T extends (...args: any[]) => any>(
  fn: T,
  options: DeprecationWarningOptions,
): T {
  const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    emitDeprecationWarning(options);
    return fn.apply(this, args);
  } as T;

  Object.defineProperty(wrapped, "name", { value: fn.name || options.name });
  return wrapped;
}

/**
 * Returns a list of all deprecation warning names emitted in the current session.
 */
export function getEmittedDeprecationWarnings(): string[] {
  return Array.from(emittedWarnings);
}

/**
 * Clears the emitted deprecation warnings set (primarily for testing).
 */
export function clearDeprecationWarnings(): void {
  emittedWarnings.clear();
}
