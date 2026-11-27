/**
 * Transaction detail view example (#103).
 *
 * Detailed transaction screens can become difficult to navigate when logs,
 * operation details, and errors are rendered as one long block. This example
 * structures the detail view with:
 *
 * - Clear section headings for each logical group (Summary, Operations, Logs, Errors)
 * - Keyboard-accessible disclosure controls (<details>/<summary>) so users can
 *   expand only the sections they need
 * - Readable top-down ordering: summary first, errors surfaced prominently,
 *   raw/verbose data last
 * - Expanded state conveyed via the native `open` attribute (screen readers
 *   announce "expanded" / "collapsed" automatically)
 *
 * Copy this into your app. All sorokit-core imports stay inside the hook;
 * this component only consumes plain data types.
 */
import { useState } from "react";
import type { DashboardTransactionEntry } from "../../src/transaction/transactionDashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionOperation {
  index: number;
  type: string;
  details: string;
}

export interface TransactionDetailProps {
  entry: DashboardTransactionEntry;
  operations?: TransactionOperation[];
  logs?: string[];
}

// ---------------------------------------------------------------------------
// Helpers (pure — easy to unit-test)
// ---------------------------------------------------------------------------

/** Returns the ordered list of section keys for a given entry. */
export function detailSections(entry: DashboardTransactionEntry): string[] {
  const sections = ["summary", "operations"];
  if (entry.tx.envelopeXdr || entry.tx.resultXdr) sections.push("raw");
  if (entry.tx.status === "failed") sections.push("errors");
  sections.push("logs");
  return sections;
}

/** Returns a human-readable label for each detail section. */
export function sectionLabel(section: string): string {
  const labels: Record<string, string> = {
    summary: "Summary",
    operations: "Operations",
    raw: "Raw XDR",
    errors: "Errors",
    logs: "Logs",
  };
  return labels[section] ?? section;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Accessible disclosure section — keyboard-navigable, state announced to AT. */
function DetailSection({
  id,
  label,
  defaultOpen = false,
  children,
}: {
  id: string;
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section aria-labelledby={`${id}-heading`}>
      {/* Use a button for keyboard operability; aria-expanded conveys state */}
      <h3 id={`${id}-heading`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "inherit", padding: 0 }}
        >
          {open ? "▾" : "▸"} {label}
        </button>
      </h3>
      <div id={`${id}-panel`} hidden={!open} role="region" aria-labelledby={`${id}-heading`}>
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TransactionDetail({ entry, operations = [], logs = [] }: TransactionDetailProps) {
  const { tx } = entry;
  const hasFailed = tx.status === "failed";

  return (
    <article aria-label={`Transaction ${tx.hash.slice(0, 8)}`}>
      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <h2>Transaction detail</h2>

      {/* ── Summary — always visible, no disclosure needed ────────────────── */}
      <section aria-labelledby="tx-summary-heading">
        <h3 id="tx-summary-heading">Summary</h3>
        <dl>
          <dt>Hash</dt>
          <dd>
            <code>{tx.hash}</code>
          </dd>
          <dt>Status</dt>
          <dd>{tx.status}</dd>
          <dt>Category</dt>
          <dd>{entry.category}</dd>
          {entry.operationType && (
            <>
              <dt>Operation type</dt>
              <dd>{entry.operationType}</dd>
            </>
          )}
          {tx.ledger !== undefined && (
            <>
              <dt>Ledger</dt>
              <dd>{tx.ledger}</dd>
            </>
          )}
          {tx.createdAt && (
            <>
              <dt>Confirmed at</dt>
              <dd>
                <time dateTime={tx.createdAt}>{tx.createdAt}</time>
              </dd>
            </>
          )}
          {tx.fee && (
            <>
              <dt>Fee (stroops)</dt>
              <dd>{tx.fee}</dd>
            </>
          )}
          {entry.processingTimeMs !== undefined && (
            <>
              <dt>Confirmation time</dt>
              <dd>{Math.round(entry.processingTimeMs)} ms</dd>
            </>
          )}
        </dl>
      </section>

      {/* ── Errors — surfaced prominently for failed transactions ──────────── */}
      {hasFailed && (
        <section aria-labelledby="tx-errors-heading" aria-live="polite">
          <h3 id="tx-errors-heading">Errors</h3>
          <p role="alert">This transaction failed.</p>
          {tx.resultXdr && (
            <DetailSection id="tx-result-xdr" label="Result XDR" defaultOpen>
              <pre style={{ overflowX: "auto" }}>
                <code>{tx.resultXdr}</code>
              </pre>
            </DetailSection>
          )}
        </section>
      )}

      {/* ── Operations — collapsible ───────────────────────────────────────── */}
      <DetailSection id="tx-operations" label="Operations" defaultOpen={operations.length > 0}>
        {operations.length === 0 ? (
          <p>No operation details available.</p>
        ) : (
          <ol>
            {operations.map((op) => (
              <li key={op.index}>
                <strong>{op.type}</strong>: {op.details}
              </li>
            ))}
          </ol>
        )}
      </DetailSection>

      {/* ── Raw XDR — collapsed by default; verbose data last ─────────────── */}
      {(tx.envelopeXdr || tx.resultXdr) && (
        <DetailSection id="tx-raw-xdr" label="Raw XDR">
          {tx.envelopeXdr && (
            <>
              <h4>Envelope</h4>
              <pre style={{ overflowX: "auto" }}>
                <code>{tx.envelopeXdr}</code>
              </pre>
            </>
          )}
          {tx.resultXdr && (
            <>
              <h4>Result</h4>
              <pre style={{ overflowX: "auto" }}>
                <code>{tx.resultXdr}</code>
              </pre>
            </>
          )}
        </DetailSection>
      )}

      {/* ── Logs — collapsed by default ───────────────────────────────────── */}
      <DetailSection id="tx-logs" label="Logs">
        {logs.length === 0 ? (
          <p>No logs.</p>
        ) : (
          <ol>
            {logs.map((line, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i}>
                <code>{line}</code>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
    </article>
  );
}
