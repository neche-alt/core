/**
 * Framework-agnostic first-run guided walkthrough manager (#108).
 *
 * Provides step-by-step navigation, persistent completion state via any
 * Storage-compatible backend, subscription-based state updates, and keyboard
 * navigation support. Designed to be consumed by any framework (React, Vue,
 * vanilla JS) through its subscription interface.
 *
 * ## Persistence
 *
 * Completion is persisted under the key
 * `sorokit:walkthrough:<id>:completed`. Storage failures are caught silently
 * so the walkthrough always works even when storage is unavailable (private
 * browsing, SSR, missing quota, etc.).
 *
 * ## Keyboard navigation
 *
 * Attach `manager.handleKeyDown` to a `keydown` event listener:
 * - `ArrowRight` / `Enter` → advance to the next step
 * - `ArrowLeft`            → go back to the previous step
 * - `Escape`               → dismiss (session-only, not persisted)
 *
 * @example
 * ```typescript
 * const manager = createWalkthroughManager({
 *   id: "demo-app",
 *   steps: [
 *     { id: "welcome", title: "Welcome", description: "Let's get started." },
 *     { id: "wallet",  title: "Connect Wallet", description: "Connect Freighter." },
 *   ],
 * });
 *
 * const unsubscribe = manager.subscribe((state) => renderUI(state));
 * document.addEventListener("keydown", manager.handleKeyDown);
 * ```
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WalkthroughStep {
  /** Stable identifier for the step. */
  id: string;
  title: string;
  description: string;
  /** Optional CSS selector for an element to highlight. */
  target?: string | undefined;
}

export interface WalkthroughConfig {
  /** Unique id used to namespace the storage key. */
  id: string;
  steps: WalkthroughStep[];
  /**
   * Storage backend for persisting completion.
   * - `undefined` (default): auto-detects `localStorage` in browsers, falls
   *   back to in-memory no-op when unavailable.
   * - `null`: disables persistence entirely.
   * - Any object satisfying the `Storage` interface.
   */
  storage?: Storage | null | undefined;
}

export interface WalkthroughState {
  /** 0-based index of the current step. */
  currentStepIndex: number;
  /** True once `complete()` has been called. */
  isComplete: boolean;
  /** True once `dismiss()` has been called this session. */
  isDismissed: boolean;
  /** Total number of steps. */
  totalSteps: number;
  /** The step currently being shown. */
  currentStep: WalkthroughStep;
}

export interface WalkthroughManager {
  /** Returns a snapshot of the current state (immutable copy). */
  getState(): WalkthroughState;
  /** Advance to the next step. No-op if already on the last step. */
  next(): WalkthroughState;
  /** Go back to the previous step. No-op if already on step 0. */
  previous(): WalkthroughState;
  /**
   * Dismiss the walkthrough for this session. The completion flag is NOT
   * persisted — the walkthrough will reappear on the next page load unless
   * the user calls `complete()`.
   */
  dismiss(): WalkthroughState;
  /** Mark the walkthrough as complete and persist the flag to storage. */
  complete(): WalkthroughState;
  /** Reset to step 0 and clear the persisted completion flag. */
  reset(): WalkthroughState;
  /**
   * Returns `true` if a previous session persisted a completion flag for
   * this walkthrough's `id`.
   */
  wasCompleted(): boolean;
  /**
   * Subscribe to state changes. The listener is called synchronously after
   * every mutation.
   * @returns An unsubscribe function.
   */
  subscribe(listener: (state: WalkthroughState) => void): () => void;
  /**
   * Keyboard event handler. Attach to a `keydown` listener while the
   * walkthrough is visible.
   *
   * - `ArrowRight` / `Enter` → `next()`
   * - `ArrowLeft`            → `previous()`
   * - `Escape`               → `dismiss()`
   */
  handleKeyDown(event: KeyboardEvent): void;
}

// ─── Internal storage helpers ─────────────────────────────────────────────────

function resolveStorage(config: WalkthroughConfig): Storage | null {
  if (config.storage === null) return null;
  if (config.storage !== undefined) return config.storage;
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage getter can throw (SecurityError in private browsing).
  }
  return null;
}

function storageKey(id: string): string {
  return `sorokit:walkthrough:${id}:completed`;
}

function readCompleted(storage: Storage | null, id: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(storageKey(id)) === "1";
  } catch {
    return false;
  }
}

function writeCompleted(storage: Storage | null, id: string): void {
  if (!storage) return;
  try {
    storage.setItem(storageKey(id), "1");
  } catch {
    // Quota exceeded or storage unavailable — degrade silently.
  }
}

function clearCompleted(storage: Storage | null, id: string): void {
  if (!storage) return;
  try {
    storage.removeItem(storageKey(id));
  } catch {
    // Degrade silently.
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a {@link WalkthroughManager} for the given configuration.
 *
 * @throws {Error} When `config.steps` is empty.
 */
export function createWalkthroughManager(config: WalkthroughConfig): WalkthroughManager {
  if (!config.steps || config.steps.length === 0) {
    throw new Error("createWalkthroughManager: steps must not be empty.");
  }

  const storage = resolveStorage(config);
  const totalSteps = config.steps.length;
  const listeners = new Set<(state: WalkthroughState) => void>();

  let currentStepIndex = 0;
  let isComplete = false;
  let isDismissed = false;

  function snapshot(): WalkthroughState {
    return {
      currentStepIndex,
      isComplete,
      isDismissed,
      totalSteps,
      currentStep: config.steps[currentStepIndex] as WalkthroughStep,
    };
  }

  function notify(): void {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function getState(): WalkthroughState {
    return snapshot();
  }

  function next(): WalkthroughState {
    if (currentStepIndex < totalSteps - 1) {
      currentStepIndex += 1;
      notify();
    }
    return snapshot();
  }

  function previous(): WalkthroughState {
    if (currentStepIndex > 0) {
      currentStepIndex -= 1;
      notify();
    }
    return snapshot();
  }

  function dismiss(): WalkthroughState {
    isDismissed = true;
    notify();
    return snapshot();
  }

  function complete(): WalkthroughState {
    isComplete = true;
    isDismissed = true;
    writeCompleted(storage, config.id);
    notify();
    return snapshot();
  }

  function reset(): WalkthroughState {
    currentStepIndex = 0;
    isComplete = false;
    isDismissed = false;
    clearCompleted(storage, config.id);
    notify();
    return snapshot();
  }

  function wasCompleted(): boolean {
    return readCompleted(storage, config.id);
  }

  function subscribe(listener: (state: WalkthroughState) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function handleKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowRight":
      case "Enter":
        next();
        break;
      case "ArrowLeft":
        previous();
        break;
      case "Escape":
        dismiss();
        break;
    }
  }

  return { getState, next, previous, dismiss, complete, reset, wasCompleted, subscribe, handleKeyDown };
}
