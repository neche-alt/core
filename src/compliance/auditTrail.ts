/**
 * Compliance audit trail with pluggable sink, retention, and tamper-evidence.
 *
 * Records are appended to an in-memory list and optionally streamed to a
 * pluggable AuditSink (file, object store, or custom callback).  A hash
 * chain links consecutive records so any post-hoc tampering is detectable.
 *
 * Retention caps the in-memory list by record count and/or record age; older
 * records are pruned after each write (they are already delivered to the sink).
 *
 * Hash chain
 * ──────────
 * Each record carries a `hash` field: FNV-1a-64(previousHash + JSON(record
 * payload)).  The genesis record uses a fixed zero string as the previous hash.
 * Call verifyHashChain(records) to validate a sequence.
 *
 * File sink
 * ─────────
 * createFileSink(path) returns an AuditSink that appends one JSON line per
 * record to the given file path.  It is the default sink when a filePath is
 * provided to createAuditTrail().
 */

import { err, ok, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";

// ── Public types ──────────────────────────────────────────────────────────────

export interface AuditContext {
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

/** A single immutable audit record. */
export interface AuditRecord {
  readonly id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly operation: string;
  readonly action: string;
  readonly actor: string;
  readonly context: Readonly<AuditContext>;
  /**
   * FNV-1a-64 hex hash of previousHash + record payload for tamper detection.
   * Present on all records created by this module.
   */
  readonly hash?: string;
  /** Hash of the record immediately before this one in the chain. */
  readonly previousHash?: string;
}

export interface AuditQueryOptions {
  actor?: string;
  action?: string;
  operation?: string;
  startTime?: string | Date | number;
  endTime?: string | Date | number;
  start?: string | Date | number;
  end?: string | Date | number;
}

export type AuditFilters = AuditQueryOptions;

export interface ComplianceDateRange {
  start?: string | Date | number;
  end?: string | Date | number;
  startTime?: string | Date | number;
  endTime?: string | Date | number;
}

export interface ComplianceAuditReport {
  generatedAt: string;
  range: { start: string; end: string };
  totalOperations: number;
  operationsByType: Record<string, number>;
  actors: string[];
  records: readonly AuditRecord[];
}

// ── Sink interface ────────────────────────────────────────────────────────────

/**
 * Pluggable sink that receives every record as it is appended.
 *
 * Implementations may write to a file, object store, or any external service.
 * Synchronous sinks (file, in-memory) are called inline.  Async sinks are
 * fire-and-forget unless the caller awaits flush() on the trail.
 */
export interface AuditSink {
  /**
   * Called after a record is committed to the in-memory trail.
   * May be synchronous or return a Promise.
   */
  write(record: AuditRecord): void | Promise<void>;
  /** Optional teardown — close file handles, flush buffers, etc. */
  close?(): void | Promise<void>;
}

// ── Retention options ─────────────────────────────────────────────────────────

export interface AuditRetentionOptions {
  /** Maximum number of records to keep in memory.  Oldest are pruned first. */
  maxRecords?: number;
  /** Maximum age in milliseconds.  Records older than this are pruned. */
  maxAgeMs?: number;
}

// ── createAuditTrail options ──────────────────────────────────────────────────

export interface AuditTrailOptions {
  /** Sink to stream records to.  Defaults to no-op (in-memory only). */
  sink?: AuditSink;
  /** Retention policy applied after each write. */
  retention?: AuditRetentionOptions;
  /**
   * File path for the built-in file sink.  Shorthand for
   * `sink: createFileSink(filePath)`.  Ignored when `sink` is also provided.
   */
  filePath?: string;
}

// ── AuditTrail interface ──────────────────────────────────────────────────────

export interface AuditTrail {
  recordOperation(
    operation: string,
    actor: string,
    context?: AuditContext,
    customTimestamp?: string | Date | number,
  ): SorokitResult<AuditRecord>;
  recordAction(
    action: string,
    actor: string,
    context?: AuditContext,
    customTimestamp?: string | Date | number,
  ): SorokitResult<AuditRecord>;
  getAuditTrail(filters?: AuditFilters): SorokitResult<readonly AuditRecord[]>;
  queryAuditLog(options?: AuditQueryOptions): SorokitResult<readonly AuditRecord[]>;
  getAllEntries(): SorokitResult<readonly AuditRecord[]>;
  clear(): void;
  generateComplianceReport(range: ComplianceDateRange): SorokitResult<ComplianceAuditReport>;
  /**
   * Verify the hash chain of the in-memory records.
   * Returns true when the chain is intact, false when tampering is detected.
   */
  verifyIntegrity(): boolean;
  /** Close the attached sink (if any) and release resources. */
  close(): Promise<void>;
}

// ── Hash chain ────────────────────────────────────────────────────────────────

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * FNV-1a 64-bit (emulated with two 32-bit halves) returned as a 16-char hex
 * string.  Deterministic, fast, and dependency-free.  Not cryptographically
 * secure but sufficient for detecting accidental or unsophisticated tampering.
 */
function fnv1a64(input: string): string {
  // FNV offset basis split into two 32-bit halves (little-endian)
  let hi = 0xcbf29ce4 >>> 0;
  let lo = 0x84222325 >>> 0;

  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xff;

    // XOR with the low byte
    lo ^= byte;

    // Multiply by FNV prime 0x00000100000001b3 (split into 32-bit halves)
    // prime_lo = 0x00000001b3, prime_hi = 0x00000100
    const lo_lo = (lo & 0xffff) * 0x000001b3;
    const lo_hi = (lo >>> 16) * 0x000001b3 + ((lo & 0xffff) * 0x00000100);
    const hi_lo = (hi & 0xffff) * 0x000001b3 + (lo_hi >>> 16);

    lo = ((lo_lo & 0xffff) | ((lo_hi & 0xffff) << 16)) >>> 0;
    hi = ((hi_lo & 0xffff) | ((hi >>> 16) * 0x000001b3 & 0xffff) << 16) >>> 0;
  }

  return (hi >>> 0).toString(16).padStart(8, "0") +
         (lo >>> 0).toString(16).padStart(8, "0");
}

function computeHash(previousHash: string, payload: Omit<AuditRecord, "hash" | "previousHash">): string {
  return fnv1a64(previousHash + JSON.stringify(payload));
}

/**
 * Verify that an ordered sequence of records forms an unbroken hash chain.
 * Returns true when every record's previousHash matches the prior record's
 * hash and every hash matches its computed value.
 */
export function verifyHashChain(records: readonly AuditRecord[]): boolean {
  if (records.length === 0) return true;

  let expectedPrevious = GENESIS_HASH;
  for (const record of records) {
    if (record.previousHash !== expectedPrevious) return false;
    if (!record.hash) return false;

    // Recompute and compare
    const { hash: _h, previousHash: _p, ...payload } = record;
    const expected = computeHash(expectedPrevious, payload);
    if (record.hash !== expected) return false;

    expectedPrevious = record.hash;
  }
  return true;
}

// ── File sink ─────────────────────────────────────────────────────────────────

/**
 * Built-in append-only file sink.
 *
 * Each record is written as a single JSON line (\`\n\`-delimited) using
 * synchronous fs.writeSync so the write completes before recordOperation
 * returns.  The file is opened lazily on the first write and closed via
 * close().
 *
 * Only available in Node.js.  In browser/edge environments this returns a
 * no-op sink with a console warning.
 */
export function createFileSink(filePath: string): AuditSink {
  const isNode =
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null;

  if (!isNode) {
    console.warn(
      "[sorokit] createFileSink: file sinks are only supported in Node.js. " +
        "Records will not be persisted to disk.",
    );
    return { write: () => undefined };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  let fd: number | null = null;

  function ensureOpen(): number {
    if (fd === null) {
      fd = fs.openSync(filePath, "a");
    }
    return fd;
  }

  return {
    write(record: AuditRecord): void {
      const line = JSON.stringify(record) + "\n";
      fs.writeSync(ensureOpen(), line, null, "utf8");
    },
    close(): void {
      if (fd !== null) {
        fs.closeSync(fd);
        fd = null;
      }
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function parseTimestamp(value: string | Date | number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  if (typeof value === "number") return Number.isNaN(value) ? NaN : value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isNaN(n) ? NaN : n;
    }
    const p = Date.parse(trimmed);
    return Number.isNaN(p) ? NaN : p;
  }
  return NaN;
}

function applyRetention(records: AuditRecord[], options: AuditRetentionOptions): void {
  if (options.maxAgeMs != null && options.maxAgeMs > 0) {
    const cutoff = Date.now() - options.maxAgeMs;
    let i = 0;
    while (i < records.length && Date.parse(records[i]!.timestamp) < cutoff) i++;
    if (i > 0) records.splice(0, i);
  }
  if (options.maxRecords != null && options.maxRecords > 0 && records.length > options.maxRecords) {
    records.splice(0, records.length - options.maxRecords);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAuditTrail(
  initialRecordsOrOptions: readonly AuditRecord[] | AuditTrailOptions = [],
  legacyOptions?: AuditTrailOptions,
): AuditTrail {
  let initialRecords: readonly AuditRecord[];
  let options: AuditTrailOptions;

  if (Array.isArray(initialRecordsOrOptions)) {
    initialRecords = initialRecordsOrOptions as readonly AuditRecord[];
    options = legacyOptions ?? {};
  } else {
    initialRecords = [];
    options = initialRecordsOrOptions as AuditTrailOptions;
  }

  let sink: AuditSink | undefined =
    options.sink ??
    (options.filePath ? createFileSink(options.filePath) : undefined);

  const retention = options.retention;
  const records: AuditRecord[] = [...initialRecords];
  let sequence = records.reduce((max, r) => Math.max(max, r.sequence ?? 0), 0);
  let lastHash: string =
    records.length > 0
      ? (records[records.length - 1]?.hash ?? GENESIS_HASH)
      : GENESIS_HASH;

  const queryAuditLog = (opts: AuditQueryOptions = {}): SorokitResult<readonly AuditRecord[]> => {
    const rawStart = opts.startTime ?? opts.start;
    const rawEnd = opts.endTime ?? opts.end;
    const startMs = parseTimestamp(rawStart);
    const endMs = parseTimestamp(rawEnd);

    if (
      (startMs !== undefined && Number.isNaN(startMs)) ||
      (endMs !== undefined && Number.isNaN(endMs)) ||
      (startMs !== undefined && endMs !== undefined && startMs > endMs)
    ) {
      return err(SorokitErrorCode.INVALID_CONFIG, "Invalid audit date range");
    }

    const filtered = records.filter((record) => {
      const ts = Date.parse(record.timestamp);
      const targetAction = opts.action ?? opts.operation;
      if (opts.actor && record.actor !== opts.actor) return false;
      if (
        targetAction &&
        record.operation !== targetAction &&
        record.action !== targetAction
      )
        return false;
      if (startMs !== undefined && ts < startMs) return false;
      if (endMs !== undefined && ts > endMs) return false;
      return true;
    });

    return ok(Object.freeze(filtered));
  };

  const recordOperation = (
    operation: string,
    actor: string,
    context: AuditContext = {},
    customTimestamp?: string | Date | number,
  ): SorokitResult<AuditRecord> => {
    if (!operation.trim() || !actor.trim()) {
      return err(SorokitErrorCode.INVALID_CONFIG, "operation and actor are required");
    }

    let timestamp: string;
    if (customTimestamp !== undefined && customTimestamp !== null) {
      const ms = parseTimestamp(customTimestamp);
      if (ms === undefined || Number.isNaN(ms)) {
        return err(SorokitErrorCode.INVALID_CONFIG, "Invalid timestamp");
      }
      timestamp = new Date(ms).toISOString();
    } else {
      timestamp = new Date().toISOString();
    }

    const previousHash = lastHash;
    const seq = ++sequence;
    const id = `${Date.now()}-${seq}`;
    const frozenContext = deepFreeze(snapshot(context));

    const payload: Omit<AuditRecord, "hash" | "previousHash"> = {
      id,
      sequence: seq,
      timestamp,
      operation,
      action: operation,
      actor,
      context: frozenContext,
    };

    const hash = computeHash(previousHash, payload);
    lastHash = hash;

    const record: AuditRecord = Object.freeze({
      ...payload,
      previousHash,
      hash,
    });

    records.push(record);

    if (retention) applyRetention(records, retention);

    // Deliver to sink — synchronous sinks complete inline; async sinks are
    // fire-and-forget (use a custom sink with explicit flush if needed).
    if (sink) {
      try {
        const result = sink.write(record);
        if (result instanceof Promise) {
          result.catch((cause: unknown) => {
            console.error(
              "[sorokit] AuditSink async write error:",
              cause instanceof Error ? cause.message : cause,
            );
          });
        }
      } catch (cause) {
        return err(
          SorokitErrorCode.INTERNAL,
          `Audit sink write failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        );
      }
    }

    return ok(record);
  };

  return {
    recordOperation,
    recordAction(action, actor, context = {}, customTimestamp) {
      return recordOperation(action, actor, context, customTimestamp);
    },
    getAuditTrail(filters = {}) {
      return queryAuditLog(filters);
    },
    queryAuditLog,
    getAllEntries() {
      return ok(Object.freeze([...records]));
    },
    clear() {
      records.length = 0;
      sequence = 0;
      lastHash = GENESIS_HASH;
    },
    generateComplianceReport(range) {
      const result = queryAuditLog(range);
      if (result.status === "error") return result;
      const operationsByType: Record<string, number> = {};
      const actors = new Set<string>();
      for (const record of result.data) {
        operationsByType[record.operation] =
          (operationsByType[record.operation] ?? 0) + 1;
        actors.add(record.actor);
      }
      const rawStart = range.startTime ?? range.start;
      const rawEnd = range.endTime ?? range.end;
      const startMs = parseTimestamp(rawStart);
      const endMs = parseTimestamp(rawEnd);
      return ok({
        generatedAt: new Date().toISOString(),
        range: {
          start: startMs !== undefined ? new Date(startMs).toISOString() : "",
          end: endMs !== undefined ? new Date(endMs).toISOString() : "",
        },
        totalOperations: result.data.length,
        operationsByType,
        actors: [...actors].sort(),
        records: result.data,
      });
    },
    verifyIntegrity() {
      return verifyHashChain(records);
    },
    async close() {
      if (sink?.close) await sink.close();
      sink = undefined;
    },
  };
}

// ── Default module-level trail (backward-compatible) ─────────────────────────

const defaultAuditTrail = createAuditTrail();
export const recordOperation = defaultAuditTrail.recordOperation;
export const recordAction = defaultAuditTrail.recordAction;
export const getAuditTrail = defaultAuditTrail.getAuditTrail;
export const queryAuditLog = defaultAuditTrail.queryAuditLog;
export const getAllEntries = defaultAuditTrail.getAllEntries;
export const clearAuditTrail = defaultAuditTrail.clear;
export const generateComplianceReport = defaultAuditTrail.generateComplianceReport;
