"use client";

/**
 * PaymentForm — Client Component.
 *
 * "use client" marks this file as a Client Component: it runs in the browser
 * and is included in the client bundle.
 *
 * IMPORTANT: Never import server-only SDK paths here:
 *   ✗  src/wallet/signTransactionOffline.ts  (uses Node crypto)
 *   ✗  src/security/keyManagement.ts         (uses Node crypto / BIP39)
 *
 * Signing happens in the Route Handler (src/app/api/sign-and-submit/route.ts),
 * not here. This component only calls that API endpoint via fetch().
 */

import { useState } from "react";

interface SendState {
  loading: boolean;
  hash: string | null;
  error: string | null;
}

export function PaymentForm() {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [send, setSend] = useState<SendState>({
    loading: false,
    hash: null,
    error: null,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSend({ loading: true, hash: null, error: null });

    try {
      // The client does not build or sign the transaction.
      // It passes the intent to the server Route Handler which uses
      // server-only signing paths and returns only the tx hash.
      const res = await fetch("/api/sign-and-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination, amount }),
      });

      const data = (await res.json()) as { hash?: string; error?: string };

      if (!res.ok) {
        setSend({ loading: false, hash: null, error: data.error ?? "Request failed" });
      } else {
        setSend({ loading: false, hash: data.hash ?? null, error: null });
      }
    } catch (err) {
      setSend({
        loading: false,
        hash: null,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <section>
      <h2>Send Payment</h2>
      <p style={{ fontSize: "0.875rem", color: "#555" }}>
        The Route Handler at <code>/api/sign-and-submit</code> signs the
        transaction server-side. Your secret key stays on the server.
      </p>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Destination address
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="G..."
              required
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label>
            Amount (XLM)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="10"
              required
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
        </div>

        <button type="submit" disabled={send.loading}>
          {send.loading ? "Sending…" : "Send via server"}
        </button>
      </form>

      {send.hash && (
        <p
          style={{
            marginTop: "1rem",
            background: "#eef6ff",
            padding: "0.75rem",
            borderRadius: 6,
          }}
        >
          Transaction confirmed:{" "}
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${send.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {send.hash}
          </a>
        </p>
      )}

      {send.error && (
        <p
          style={{
            marginTop: "1rem",
            background: "#fdecec",
            color: "#8a1c1c",
            padding: "0.75rem",
            borderRadius: 6,
          }}
        >
          {send.error}
        </p>
      )}
    </section>
  );
}
