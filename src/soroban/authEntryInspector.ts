/**
 * Soroban authorization entry inspection (#38).
 *
 * Provides safe, structured inspection of SorobanAuthorizationEntry objects
 * returned from simulation, helping developers understand which invocations
 * require which credentials — without throwing on malformed or partial input.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Structured credential requirement for a single contract invocation within
 * a Soroban auth entry.
 */
export interface AuthEntryCredential {
  /** Contract address (C-strkey or hex-encoded contract id). */
  contractId: string;
  /** Name of the function being authorized. */
  functionName: string;
  /** Decoded argument values (best-effort; unknown[] on XDR parse failure). */
  args: unknown[];
  /**
   * Nonce used by the credential when present (sorobanCredentials type).
   * `null` for source-account credentials or when the nonce cannot be read.
   */
  nonce: bigint | null;
  /**
   * Ledger sequence after which the authorization expires.
   * `null` when unavailable.
   */
  expirationLedger: number | null;
  /** Raw credential type name as returned by the XDR switch, e.g. "scCredentialsSourceAccount". */
  credentialType: string;
}

/** Full inspection result for one SorobanAuthorizationEntry. */
export interface AuthEntryInspection {
  /** Top-level credential requirements. */
  credentials: AuthEntryCredential[];
  /**
   * Function names whose required credentials could not be fully resolved
   * (e.g. because the XDR shape was unexpected).
   */
  missingCredentials: string[];
  /**
   * Credentials found in nested sub-invocations (depth ≥ 1).
   * These also need to be signed unless they are source-account credentials.
   */
  nestedInvocations: AuthEntryCredential[];
  /** The original entry value, preserved for downstream inspection. */
  raw: unknown;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && value !== undefined) {
    try {
      return String(value);
    } catch {
      // ignore
    }
  }
  return "";
}

function safeContractId(contractAddress: unknown): string {
  if (!contractAddress || typeof contractAddress !== "object") return "";
  try {
    const addr = contractAddress as Record<string, unknown>;
    // contractId() returns a Buffer/Uint8Array with the raw bytes
    if (typeof addr["contractId"] === "function") {
      const raw = (addr["contractId"] as () => unknown)();
      if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
        return Buffer.from(raw).toString("hex");
      }
      return safeString(raw);
    }
    // Fallback: try .value() used in some SDK versions
    if (typeof addr["value"] === "function") {
      return safeString((addr["value"] as () => unknown)());
    }
  } catch {
    // ignore
  }
  return "";
}

function safeArgs(argsAccessor: unknown): unknown[] {
  if (typeof argsAccessor !== "function") return [];
  try {
    const result = (argsAccessor as () => unknown)();
    if (Array.isArray(result)) return result;
  } catch {
    // ignore
  }
  return [];
}

function extractCredentialMeta(entry: Record<string, unknown>): {
  credentialType: string;
  nonce: bigint | null;
  expirationLedger: number | null;
} {
  let credentialType = "unknown";
  let nonce: bigint | null = null;
  let expirationLedger: number | null = null;

  try {
    const creds = entry["credentials"];
    if (creds && typeof creds === "object") {
      const c = creds as Record<string, unknown>;
      if (typeof c["type"] === "function") {
        const t = (c["type"] as () => unknown)();
        if (t && typeof t === "object") {
          credentialType = safeString((t as Record<string, unknown>)["name"]);
        }
      }
      // sorobanCredentials path
      if (typeof c["sorobanCredentials"] === "function") {
        const sc = (c["sorobanCredentials"] as () => unknown)() as Record<string, unknown> | null;
        if (sc) {
          if (typeof sc["nonce"] === "function") {
            const n = (sc["nonce"] as () => unknown)();
            try { nonce = BigInt(safeString(n)); } catch { /* ignore */ }
          }
          if (typeof sc["signatureExpirationLedger"] === "function") {
            const exp = (sc["signatureExpirationLedger"] as () => unknown)();
            if (typeof exp === "number") expirationLedger = exp;
            else { try { expirationLedger = Number(exp); } catch { /* ignore */ } }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return { credentialType, nonce, expirationLedger };
}

/**
 * Recursively collect credentials from an invocation node and all its
 * sub-invocations.
 */
function collectFromInvocation(
  invocation: unknown,
  credentialMeta: { credentialType: string; nonce: bigint | null; expirationLedger: number | null },
  depth: number,
  root: AuthEntryCredential[],
  nested: AuthEntryCredential[],
  missing: string[],
): void {
  if (!invocation || typeof invocation !== "object") return;

  const inv = invocation as Record<string, unknown>;
  let contractId = "";
  let functionName = "";
  let args: unknown[] = [];

  try {
    contractId = safeContractId(
      typeof inv["contractAddress"] === "function"
        ? (inv["contractAddress"] as () => unknown)()
        : inv["contractAddress"],
    );

    const rawFn = typeof inv["functionName"] === "function"
      ? (inv["functionName"] as () => unknown)()
      : inv["functionName"];
    functionName = safeString(rawFn);

    args = safeArgs(inv["args"]);
  } catch {
    // ignore
  }

  if (!functionName && !contractId) {
    missing.push("unknown");
    return;
  }

  const credential: AuthEntryCredential = {
    contractId,
    functionName,
    args,
    nonce: depth === 0 ? credentialMeta.nonce : null,
    expirationLedger: depth === 0 ? credentialMeta.expirationLedger : null,
    credentialType: credentialMeta.credentialType,
  };

  if (depth === 0) {
    root.push(credential);
  } else {
    nested.push(credential);
  }

  // Recurse into sub-invocations
  try {
    const subInvocationsRaw = typeof inv["subInvocations"] === "function"
      ? (inv["subInvocations"] as () => unknown)()
      : inv["subInvocations"];
    if (Array.isArray(subInvocationsRaw)) {
      for (const sub of subInvocationsRaw) {
        collectFromInvocation(sub, credentialMeta, depth + 1, root, nested, missing);
      }
    }
  } catch {
    // ignore
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Safely inspect a Soroban authorization entry.
 *
 * Accepts the XDR `SorobanAuthorizationEntry` object returned by the Soroban
 * RPC simulation response, or any duck-typed object with compatible `.credentials`
 * and `.rootInvocation` accessors. Returns structured credential information
 * including nested sub-invocations. Never throws.
 *
 * ```ts
 * const inspection = inspectAuthEntry(authEntry);
 * console.log(inspection.credentials);       // top-level credential requirements
 * console.log(inspection.nestedInvocations); // sub-calls that also need signing
 * console.log(inspection.missingCredentials); // entries that could not be resolved
 * ```
 *
 * @param entry - A SorobanAuthorizationEntry or compatible object.
 * @returns Structured {@link AuthEntryInspection}.
 */
export function inspectAuthEntry(entry: unknown): AuthEntryInspection {
  const credentials: AuthEntryCredential[] = [];
  const nestedInvocations: AuthEntryCredential[] = [];
  const missingCredentials: string[] = [];

  if (!entry || typeof entry !== "object") {
    return { credentials, missingCredentials, nestedInvocations, raw: entry };
  }

  try {
    const e = entry as Record<string, unknown>;
    const credentialMeta = extractCredentialMeta(e);

    // rootInvocation may be a direct object or a function accessor
    const rootInvocation = typeof e["rootInvocation"] === "function"
      ? (e["rootInvocation"] as () => unknown)()
      : e["rootInvocation"];

    if (rootInvocation) {
      collectFromInvocation(
        rootInvocation,
        credentialMeta,
        0,
        credentials,
        nestedInvocations,
        missingCredentials,
      );
    } else {
      missingCredentials.push("rootInvocation");
    }
  } catch {
    // Any unexpected XDR shape — degrade gracefully
    missingCredentials.push("unknown");
  }

  return { credentials, missingCredentials, nestedInvocations, raw: entry };
}

export interface AuthorizationDiagnostic {
  /** Human-readable explanation of the authorization failure. */
  message: string;
  /** Function names whose credentials appear to be missing. */
  missingCredentials: string[];
  /** Actionable suggestion for the developer. */
  hint: string;
}

/**
 * Produce a human-readable diagnostic for a Soroban authorization failure.
 *
 * Accepts any error value (HostError, Error, string, SorokitResult envelope)
 * and optional auth entries from the failed simulation. Returns a structured
 * diagnostic with an actionable hint. Never throws.
 *
 * ```ts
 * const diag = diagnoseAuthorizationFailure(error, authEntries);
 * console.log(diag.message); // "Authorization required for: transfer"
 * console.log(diag.hint);    // actionable suggestion
 * ```
 *
 * @param error      - The error from a failed invocation or simulation.
 * @param authEntries - Optional auth entries from the simulation response.
 * @returns An {@link AuthorizationDiagnostic}.
 */
export function diagnoseAuthorizationFailure(
  error: unknown,
  authEntries?: unknown[],
): AuthorizationDiagnostic {
  let rawMessage = "";

  try {
    if (typeof error === "string") {
      rawMessage = error;
    } else if (error instanceof Error) {
      rawMessage = error.message;
    } else if (error !== null && typeof error === "object") {
      const o = error as Record<string, unknown>;
      if (typeof o["message"] === "string") rawMessage = o["message"];
      else if (typeof o["error"] === "object" && o["error"] !== null) {
        const inner = o["error"] as Record<string, unknown>;
        if (typeof inner["message"] === "string") rawMessage = inner["message"];
      }
    }
  } catch {
    // ignore
  }

  const isAuthError =
    /auth|unauthorized|signing|credential|require.*sign/i.test(rawMessage) ||
    rawMessage.length === 0;

  const missingCredentials: string[] = [];

  if (isAuthError && Array.isArray(authEntries) && authEntries.length > 0) {
    for (const entry of authEntries) {
      try {
        const inspection = inspectAuthEntry(entry);
        for (const c of inspection.credentials) {
          if (c.functionName) missingCredentials.push(c.functionName);
        }
        for (const c of inspection.nestedInvocations) {
          if (c.functionName && !missingCredentials.includes(c.functionName)) {
            missingCredentials.push(c.functionName);
          }
        }
        missingCredentials.push(...inspection.missingCredentials.filter(
          m => m !== "unknown" && m !== "rootInvocation",
        ));
      } catch {
        // ignore
      }
    }
  }

  let message: string;
  let hint: string;

  if (missingCredentials.length > 0) {
    message = `Authorization required for: ${missingCredentials.join(", ")}`;
    hint =
      "Sign each listed authorization entry with the appropriate account before submitting the transaction.";
  } else if (isAuthError) {
    message = rawMessage
      ? `Authorization failure: ${rawMessage}`
      : "Authorization failure: no auth entry details available.";
    hint =
      "Inspect the simulation response's auth entries with inspectAuthEntry() to identify which invocations require signing.";
  } else {
    message = rawMessage || "An unexpected error occurred during contract invocation.";
    hint =
      "Check the full error details and verify the contract invocation parameters.";
  }

  return { message, missingCredentials, hint };
}
