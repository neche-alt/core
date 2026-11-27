/**
 * Tests for the first-run guided walkthrough manager (#108).
 *
 * Covers: step navigation, boundary behaviour, dismiss vs complete,
 * storage persistence, storage failure resilience, subscription, and
 * keyboard navigation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWalkthroughManager } from "../shared/walkthroughManager";
import type { WalkthroughConfig } from "../shared/walkthroughManager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  } as Storage;
}

const BASE_STEPS = [
  { id: "s1", title: "Step 1", description: "First step." },
  { id: "s2", title: "Step 2", description: "Second step." },
  { id: "s3", title: "Step 3", description: "Third step." },
];

function makeManager(overrides: Partial<WalkthroughConfig> = {}, storage?: Storage) {
  return createWalkthroughManager({
    id: "test-walkthrough",
    steps: BASE_STEPS,
    storage: storage ?? null, // null = no persistence by default in tests
    ...overrides,
  });
}

// ─── Initialisation ───────────────────────────────────────────────────────────

describe("createWalkthroughManager — initialisation", () => {
  it("starts at step 0 with isComplete=false and isDismissed=false", () => {
    const m = makeManager();
    const state = m.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.isDismissed).toBe(false);
    expect(state.totalSteps).toBe(3);
  });

  it("exposes the correct currentStep for the starting index", () => {
    const m = makeManager();
    expect(m.getState().currentStep.id).toBe("s1");
  });

  it("throws when steps is empty", () => {
    expect(() => createWalkthroughManager({ id: "x", steps: [], storage: null })).toThrow(
      /steps must not be empty/,
    );
  });
});

// ─── Navigation ───────────────────────────────────────────────────────────────

describe("createWalkthroughManager — navigation", () => {
  it("next() advances the step index", () => {
    const m = makeManager();
    m.next();
    expect(m.getState().currentStepIndex).toBe(1);
    expect(m.getState().currentStep.id).toBe("s2");
  });

  it("next() on the last step does not overflow", () => {
    const m = makeManager();
    m.next(); m.next(); // reach last step (index 2)
    m.next(); // should stay at 2
    expect(m.getState().currentStepIndex).toBe(2);
  });

  it("previous() goes back one step", () => {
    const m = makeManager();
    m.next();
    m.previous();
    expect(m.getState().currentStepIndex).toBe(0);
  });

  it("previous() on step 0 stays at 0", () => {
    const m = makeManager();
    m.previous();
    expect(m.getState().currentStepIndex).toBe(0);
  });

  it("next() returns the new state", () => {
    const m = makeManager();
    const state = m.next();
    expect(state.currentStepIndex).toBe(1);
  });

  it("previous() returns the new state", () => {
    const m = makeManager();
    m.next();
    const state = m.previous();
    expect(state.currentStepIndex).toBe(0);
  });
});

// ─── Dismiss ──────────────────────────────────────────────────────────────────

describe("createWalkthroughManager — dismiss", () => {
  it("dismiss() sets isDismissed=true", () => {
    const m = makeManager();
    m.dismiss();
    expect(m.getState().isDismissed).toBe(true);
  });

  it("dismiss() does NOT set isComplete", () => {
    const m = makeManager();
    m.dismiss();
    expect(m.getState().isComplete).toBe(false);
  });

  it("dismiss() does NOT persist to storage", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    m.dismiss();
    expect(storage.getItem("sorokit:walkthrough:test-walkthrough:completed")).toBeNull();
  });
});

// ─── Complete ─────────────────────────────────────────────────────────────────

describe("createWalkthroughManager — complete", () => {
  it("complete() sets isComplete=true and isDismissed=true", () => {
    const m = makeManager();
    m.complete();
    const state = m.getState();
    expect(state.isComplete).toBe(true);
    expect(state.isDismissed).toBe(true);
  });

  it("complete() persists completion flag to storage", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    m.complete();
    expect(storage.getItem("sorokit:walkthrough:test-walkthrough:completed")).toBe("1");
  });

  it("wasCompleted() returns true after complete() when storage is provided", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    expect(m.wasCompleted()).toBe(false);
    m.complete();
    expect(m.wasCompleted()).toBe(true);
  });

  it("wasCompleted() returns false before completion", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    expect(m.wasCompleted()).toBe(false);
  });

  it("wasCompleted() returns false when storage is null", () => {
    const m = makeManager({ storage: null });
    m.complete();
    expect(m.wasCompleted()).toBe(false);
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────────

describe("createWalkthroughManager — reset", () => {
  it("reset() returns to step 0 and clears isComplete and isDismissed", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    m.next();
    m.complete();
    m.reset();
    const state = m.getState();
    expect(state.currentStepIndex).toBe(0);
    expect(state.isComplete).toBe(false);
    expect(state.isDismissed).toBe(false);
  });

  it("reset() removes the persisted completion flag", () => {
    const storage = makeStorage();
    const m = makeManager({}, storage);
    m.complete();
    expect(storage.getItem("sorokit:walkthrough:test-walkthrough:completed")).toBe("1");
    m.reset();
    expect(storage.getItem("sorokit:walkthrough:test-walkthrough:completed")).toBeNull();
  });
});

// ─── Subscription ─────────────────────────────────────────────────────────────

describe("createWalkthroughManager — subscribe", () => {
  it("subscribe listener is called on next()", () => {
    const m = makeManager();
    const listener = vi.fn();
    m.subscribe(listener);
    m.next();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].currentStepIndex).toBe(1);
  });

  it("subscribe listener is called on dismiss()", () => {
    const m = makeManager();
    const listener = vi.fn();
    m.subscribe(listener);
    m.dismiss();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].isDismissed).toBe(true);
  });

  it("unsubscribe stops notifications", () => {
    const m = makeManager();
    const listener = vi.fn();
    const unsub = m.subscribe(listener);
    unsub();
    m.next();
    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple subscribers all receive updates", () => {
    const m = makeManager();
    const l1 = vi.fn();
    const l2 = vi.fn();
    m.subscribe(l1);
    m.subscribe(l2);
    m.next();
    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });
});

// ─── Keyboard navigation ──────────────────────────────────────────────────────

describe("createWalkthroughManager — handleKeyDown", () => {
  function makeEvent(key: string): KeyboardEvent {
    return { key } as KeyboardEvent;
  }

  it("ArrowRight advances to next step", () => {
    const m = makeManager();
    m.handleKeyDown(makeEvent("ArrowRight"));
    expect(m.getState().currentStepIndex).toBe(1);
  });

  it("Enter advances to next step", () => {
    const m = makeManager();
    m.handleKeyDown(makeEvent("Enter"));
    expect(m.getState().currentStepIndex).toBe(1);
  });

  it("ArrowLeft goes back a step", () => {
    const m = makeManager();
    m.next();
    m.handleKeyDown(makeEvent("ArrowLeft"));
    expect(m.getState().currentStepIndex).toBe(0);
  });

  it("Escape dismisses the walkthrough", () => {
    const m = makeManager();
    m.handleKeyDown(makeEvent("Escape"));
    expect(m.getState().isDismissed).toBe(true);
  });

  it("unrecognised keys are ignored", () => {
    const m = makeManager();
    m.handleKeyDown(makeEvent("Tab"));
    expect(m.getState().currentStepIndex).toBe(0);
    expect(m.getState().isDismissed).toBe(false);
  });
});

// ─── Storage failure resilience ───────────────────────────────────────────────

describe("createWalkthroughManager — storage failure resilience", () => {
  it("does not throw when storage.setItem throws", () => {
    const storage = makeStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const m = makeManager({}, storage);
    expect(() => m.complete()).not.toThrow();
    expect(m.getState().isComplete).toBe(true);
  });

  it("does not throw when storage.getItem throws", () => {
    const storage = makeStorage();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const m = makeManager({}, storage);
    expect(() => m.wasCompleted()).not.toThrow();
    expect(m.wasCompleted()).toBe(false);
  });

  it("operates normally with null storage (no persistence)", () => {
    const m = makeManager({ storage: null });
    m.next();
    m.complete();
    expect(m.getState().isComplete).toBe(true);
    // wasCompleted returns false because there is no storage
    expect(m.wasCompleted()).toBe(false);
  });
});
