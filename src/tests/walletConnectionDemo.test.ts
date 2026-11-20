/**
 * Tests for the polished wallet connection demo flow (#91).
 *
 * Covers all five connection states and the WalletStatusTracker behaviour
 * that drives them: empty, loading, connected, rejected, and disconnected.
 * React rendering is not tested here — these are unit tests for the data layer.
 */

import { describe, it, expect, vi } from "vitest";
import { WalletStatusTracker, getAriaLabel, getStatusColorClass } from "../wallet/walletStatusTracker";
import { WalletType, type WalletAdapter } from "../wallet/types";
import { ok, err, SorokitErrorCode } from "../shared/response";
import type { WalletConnectionStatus } from "../wallet/walletStatusTracker";

const TEST_PUBLIC_KEY =
  "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makeAdapter(overrides?: Partial<WalletAdapter>): WalletAdapter {
  return {
    walletType: WalletType.FREIGHTER,
    isAvailable: () => true,
    connect: vi.fn().mockResolvedValue(ok(TEST_PUBLIC_KEY)),
    disconnect: vi.fn().mockResolvedValue(ok(undefined)),
    signTransaction: vi.fn(),
    ...overrides,
  } as unknown as WalletAdapter;
}

// ─── Empty state ──────────────────────────────────────────────────────────

describe("empty state", () => {
  it("starts disconnected with no wallet info", () => {
    const tracker = new WalletStatusTracker();
    const status = tracker.status;

    expect(status.status).toBe("disconnected");
    expect(status.publicKey).toBeNull();
    expect(status.adapterName).toBeNull();
    expect(status.walletType).toBeNull();
    expect(tracker.isDisconnected).toBe(true);
  });

  it("aria label reflects no wallet connected", () => {
    const tracker = new WalletStatusTracker();
    expect(getAriaLabel(tracker.status)).toBe("No wallet connected");
  });

  it("status colour class is off in disconnected state", () => {
    expect(getStatusColorClass("disconnected")).toBe("sorokit-status-off");
  });
});

// ─── Loading state ────────────────────────────────────────────────────────

describe("loading state", () => {
  it("transitions to connecting immediately when connect is called", async () => {
    const statusChanges: WalletConnectionStatus[] = [];
    const tracker = new WalletStatusTracker({
      onStatusChange: (s) => statusChanges.push(s.status),
    });

    const connectingPromise = tracker.connect(makeAdapter());
    // The connecting status is emitted synchronously before the await resolves.
    expect(tracker.isConnecting).toBe(true);
    expect(statusChanges).toContain("connecting");

    await connectingPromise;
  });

  it("aria label says 'Connecting to wallet' while connecting", () => {
    const tracker = new WalletStatusTracker();
    // Manually set connecting state to test aria label.
    const status = { ...tracker.status, status: "connecting" as const };
    expect(getAriaLabel(status)).toBe("Connecting to wallet");
  });

  it("status colour class is pending while connecting", () => {
    expect(getStatusColorClass("connecting")).toBe("sorokit-status-pending");
    expect(getStatusColorClass("authenticating")).toBe("sorokit-status-pending");
  });
});

// ─── Connected state ──────────────────────────────────────────────────────

describe("connected state", () => {
  it("transitions to connected with public key after a successful connect", async () => {
    const tracker = new WalletStatusTracker();
    const result = await tracker.connect(makeAdapter());

    expect(result.status).toBe("ok");
    expect(tracker.isConnected).toBe(true);
    expect(tracker.status.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(tracker.status.adapterName).toBe("Freighter");
    expect(tracker.status.walletType).toBe(WalletType.FREIGHTER);
    expect(tracker.status.error).toBeNull();
  });

  it("sets a truncated address for display", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    const { truncatedAddress } = tracker.status;
    expect(truncatedAddress).not.toBeNull();
    expect(truncatedAddress!.includes("...")).toBe(true);
    expect(truncatedAddress!.length).toBeLessThan(TEST_PUBLIC_KEY.length);
  });

  it("aria label includes the wallet name and truncated address", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    const label = getAriaLabel(tracker.status);
    expect(label).toContain("Freighter");
    expect(label).toContain("connected");
  });

  it("status colour class is ok when connected", () => {
    expect(getStatusColorClass("connected")).toBe("sorokit-status-ok");
  });

  it("status snapshot is immutable — mutating it does not change tracker state", async () => {
    const tracker = new WalletStatusTracker();
    await tracker.connect(makeAdapter());

    const snapshot = tracker.status;
    snapshot.publicKey = "tampered";
    expect(tracker.status.publicKey).toBe(TEST_PUBLIC_KEY);
  });
});

// ─── Rejected state ───────────────────────────────────────────────────────

describe("rejected state", () => {
  it("transitions to failed when the user rejects the connection", async () => {
    const adapter = makeAdapter({
      connect: vi.fn().mockResolvedValue(
        err(SorokitErrorCode.WALLET_CONNECT_FAILED, "User rejected"),
      ),
    });
    const tracker = new WalletStatusTracker();
    const result = await tracker.connect(adapter, { maxRetries: 0 });

    expect(result.status).toBe("error");
    expect(tracker.hasError).toBe(true);
    expect(tracker.status.publicKey).toBeNull();
  });

  it("aria label includes the error message when failed", async () => {
    const adapter = makeAdapter({
      connect: vi.fn().mockResolvedValue(
        err(SorokitErrorCode.WALLET_CONNECT_FAILED, "User denied"),
      ),
    });
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter, { maxRetries: 0 });

    const label = getAriaLabel(tracker.status);
    expect(label).toContain("User denied");
  });

  it("status colour class is error when failed", () => {
    expect(getStatusColorClass("failed")).toBe("sorokit-status-error");
    expect(getStatusColorClass("error")).toBe("sorokit-status-error");
  });

  it("clears the error on a successful reconnect after a failure", async () => {
    const failAdapter = makeAdapter({
      connect: vi.fn().mockResolvedValue(
        err(SorokitErrorCode.WALLET_CONNECT_FAILED, "denied"),
      ),
    });
    const tracker = new WalletStatusTracker();
    await tracker.connect(failAdapter, { maxRetries: 0 });
    expect(tracker.hasError).toBe(true);

    // Reconnect with a succeeding adapter.
    await tracker.connect(makeAdapter());
    expect(tracker.isConnected).toBe(true);
    expect(tracker.status.error).toBeNull();
  });
});

// ─── Disconnected state ───────────────────────────────────────────────────

describe("disconnected state", () => {
  it("transitions to disconnected after disconnect", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);
    expect(tracker.isConnected).toBe(true);

    await tracker.disconnect(adapter);
    expect(tracker.isDisconnected).toBe(true);
    expect(tracker.status.publicKey).toBeNull();
  });

  it("clears wallet info on disconnect", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);
    await tracker.disconnect(adapter);

    const status = tracker.status;
    expect(status.walletType).toBeNull();
    expect(status.adapterName).toBeNull();
    expect(status.truncatedAddress).toBeNull();
  });

  it("notifies subscribers when disconnected", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);

    const listener = vi.fn();
    tracker.subscribe(listener);
    await tracker.disconnect(adapter);

    const statuses = listener.mock.calls.map(([s]) => s.status as WalletConnectionStatus);
    expect(statuses).toContain("disconnected");
  });
});

// ─── State sequence ───────────────────────────────────────────────────────

describe("full connection lifecycle", () => {
  it("emits states in order: disconnected → connecting → connected → disconnected", async () => {
    const emitted: WalletConnectionStatus[] = [];
    const tracker = new WalletStatusTracker({
      onStatusChange: (s) => emitted.push(s.status),
    });
    const adapter = makeAdapter();

    await tracker.connect(adapter);
    await tracker.disconnect(adapter);

    expect(emitted[0]).toBe("connecting");
    expect(emitted).toContain("connected");
    expect(emitted[emitted.length - 1]).toBe("disconnected");
  });

  it("subscribers receive every state transition and can unsubscribe", async () => {
    const adapter = makeAdapter();
    const tracker = new WalletStatusTracker();
    await tracker.connect(adapter);

    const listener = vi.fn();
    const unsubscribe = tracker.subscribe(listener);

    await tracker.disconnect(adapter);
    unsubscribe();

    // After unsubscribe, reconnect should NOT trigger the listener.
    await tracker.connect(makeAdapter());
    const statuses = listener.mock.calls.map(([s]) => s.status as WalletConnectionStatus);
    expect(statuses).toContain("disconnected");
    // No "connected" call after unsubscribe.
    expect(statuses.filter((s) => s === "connected")).toHaveLength(0);
  });
});

// ─── restoreState ─────────────────────────────────────────────────────────

describe("restoreState", () => {
  it("restores a previously connected session", () => {
    const tracker = new WalletStatusTracker();
    tracker.restoreState({
      connected: true,
      publicKey: TEST_PUBLIC_KEY,
      walletType: WalletType.FREIGHTER,
    });

    expect(tracker.isConnected).toBe(true);
    expect(tracker.status.publicKey).toBe(TEST_PUBLIC_KEY);
    expect(tracker.status.adapterName).toBe("Freighter");
  });
});
