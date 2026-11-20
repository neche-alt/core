/**
 * Focused tests for accessible wallet connection controls (#94).
 *
 * Tests the data layer that feeds AccessibleWalletControls:
 * - getAriaLabel covers every connection state
 * - getStatusColorClass covers every connection state
 * - WalletStatusTracker emits aria-label-ready status values on each transition
 * - No sensitive data appears in any status value
 * - All control states (keyboard, focus, disabled) are expressed through tracker state
 *
 * React rendering is not tested here — these are unit tests for the data layer.
 */

import { describe, it, expect, vi } from "vitest";
import {
  WalletStatusTracker,
  getAriaLabel,
  getStatusColorClass,
  truncatePublicKey,
} from "../wallet/walletStatusTracker";
import { WalletType, type WalletAdapter } from "../wallet/types";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { WalletConnectionStatus, WalletStatus } from "../wallet/walletStatusTracker";

const TEST_KEY = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makeAdapter(overrides?: Partial<WalletAdapter>): WalletAdapter {
  return {
    walletType: WalletType.FREIGHTER,
    isAvailable: () => true,
    connect: vi.fn().mockResolvedValue(ok(TEST_KEY)),
    disconnect: vi.fn().mockResolvedValue(ok(undefined)),
    signTransaction: vi.fn(),
    ...overrides,
  } as unknown as WalletAdapter;
}

function statusWith(
  status: WalletConnectionStatus,
  overrides: Partial<WalletStatus> = {},
): WalletStatus {
  return {
    status,
    walletType: null,
    publicKey: null,
    adapterName: null,
    truncatedAddress: null,
    error: null,
    ...overrides,
  };
}

// ─── getAriaLabel — all states ─────────────────────────────────────────────

describe("getAriaLabel", () => {
  it("announces no wallet when disconnected", () => {
    expect(getAriaLabel(statusWith("disconnected"))).toBe("No wallet connected");
  });

  it("announces connecting to wallet", () => {
    expect(getAriaLabel(statusWith("connecting"))).toBe("Connecting to wallet");
  });

  it("announces connecting to wallet when authenticating", () => {
    expect(getAriaLabel(statusWith("authenticating"))).toBe("Connecting to wallet");
  });

  it("announces wallet name and truncated address when connected", () => {
    const label = getAriaLabel(
      statusWith("connected", {
        adapterName: "Freighter",
        truncatedAddress: truncatePublicKey(TEST_KEY),
      }),
    );
    expect(label).toContain("Freighter");
    expect(label).toContain("connected");
    expect(label).toContain(truncatePublicKey(TEST_KEY));
  });

  it("announces error message when failed", () => {
    const label = getAriaLabel(statusWith("failed", { error: "User rejected" }));
    expect(label).toContain("User rejected");
  });

  it("announces error message when in error state", () => {
    const label = getAriaLabel(statusWith("error", { error: "Extension missing" }));
    expect(label).toContain("Extension missing");
  });

  it("produces a non-empty string for every status", () => {
    const statuses: WalletConnectionStatus[] = [
      "disconnected", "connecting", "authenticating", "connected", "failed", "error",
    ];
    for (const status of statuses) {
      const label = getAriaLabel(statusWith(status, { error: "err", adapterName: "W", truncatedAddress: "G...Z" }));
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ─── getStatusColorClass ──────────────────────────────────────────────────────

describe("getStatusColorClass", () => {
  it("maps connected to ok class", () => {
    expect(getStatusColorClass("connected")).toBe("sorokit-status-ok");
  });

  it("maps connecting and authenticating to pending class", () => {
    expect(getStatusColorClass("connecting")).toBe("sorokit-status-pending");
    expect(getStatusColorClass("authenticating")).toBe("sorokit-status-pending");
  });

  it("maps disconnected to off class", () => {
    expect(getStatusColorClass("disconnected")).toBe("sorokit-status-off");
  });

  it("maps failed and error to error class", () => {
    expect(getStatusColorClass("failed")).toBe("sorokit-status-error");
    expect(getStatusColorClass("error")).toBe("sorokit-status-error");
  });

  it("returns a non-empty string for all statuses", () => {
    const statuses: WalletConnectionStatus[] = [
      "disconnected", "connecting", "authenticating", "connected", "failed", "error",
    ];
    for (const status of statuses) {
      expect(getStatusColorClass(status).length).toBeGreaterThan(0);
    }
  });
});

// ─── Keyboard-operation readiness (disabled state via tracker) ─────────────

describe("busy / disabled state via tracker", () => {
  it("isConnecting is true while the connection is in progress", async () => {
    let resolveConnect!: (v: string) => void;
    const connectPromise = new Promise<string>((res) => { resolveConnect = res; });

    const adapter = makeAdapter({
      connect: vi.fn().mockReturnValue(connectPromise.then(ok)),
    });
    const tracker = new WalletStatusTracker();
    const pending = tracker.connect(adapter);

    // Before the promise resolves the tracker is connecting — controls should be disabled.
    expect(tracker.isConnecting).toBe(true);

    resolveConnect(TEST_KEY);
    await pending;

    expect(tracker.isConnected).toBe(true);
  });

  it("isConnecting is false once connected — controls become active", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    expect(tracker.isConnecting).toBe(false);
    expect(tracker.isConnected).toBe(true);
  });
});

// ─── Focus-visible label content (via getAriaLabel post-transition) ──────────

describe("accessible names via tracker transitions", () => {
  it("aria label changes to reflect connected state after successful connect", async () => {
    const tracker = new WalletStatusTracker();
    expect(getAriaLabel(tracker.status)).toBe("No wallet connected");

    await tracker.connect(makeAdapter());
    const label = getAriaLabel(tracker.status);
    expect(label).toContain("connected");
    expect(label).toContain("Freighter");
  });

  it("aria label reflects disconnected state after disconnect", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);
    await tracker.disconnect(adapter);

    expect(getAriaLabel(tracker.status)).toBe("No wallet connected");
  });

  it("aria label includes error message after a failed connect", async () => {
    const adapter = makeAdapter({
      connect: vi.fn().mockResolvedValue(err(SorokitErrorCode.WALLET_CONNECT_FAILED, "Denied by user")),
    });
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter, { maxRetries: 0 });

    const label = getAriaLabel(tracker.status);
    expect(label).toContain("Denied by user");
  });
});

// ─── Live region content — no secrets ────────────────────────────────────────

describe("no secrets in status values", () => {
  it("aria label never contains a private key, seed, or secret", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    const label = getAriaLabel(tracker.status).toLowerCase();
    for (const forbidden of ["secret", "privatekey", "private_key", "seed", "mnemonic"]) {
      expect(label).not.toContain(forbidden);
    }
  });

  it("status object never contains a full unmasked public key in truncatedAddress", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    expect(tracker.status.truncatedAddress).not.toBe(TEST_KEY);
    expect(tracker.status.truncatedAddress?.includes("...")).toBe(true);
  });
});

// ─── Subscriber-based status announcement ────────────────────────────────────

describe("status announcements via subscriber", () => {
  it("subscriber receives a new status for each transition", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    const received: WalletConnectionStatus[] = [];
    tracker.subscribe((s) => received.push(s.status));

    await tracker.connect(adapter);
    await tracker.disconnect(adapter);

    expect(received).toContain("connecting");
    expect(received).toContain("connected");
    expect(received).toContain("disconnected");
  });

  it("unsubscribed listener does not receive further announcements", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);

    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);
    unsubscribe();

    await tracker.disconnect(adapter);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── truncatePublicKey ────────────────────────────────────────────────────────

describe("truncatePublicKey", () => {
  it("shortens a full public key for display", () => {
    const truncated = truncatePublicKey(TEST_KEY);
    expect(truncated.length).toBeLessThan(TEST_KEY.length);
    expect(truncated).toContain("...");
  });

  it("preserves short keys unchanged", () => {
    expect(truncatePublicKey("GABCD")).toBe("GABCD");
  });

  it("starts and ends with key characters", () => {
    const truncated = truncatePublicKey(TEST_KEY, 4);
    expect(truncated.startsWith(TEST_KEY.slice(0, 4))).toBe(true);
    expect(truncated.endsWith(TEST_KEY.slice(-4))).toBe(true);
  });
});
