/**
 * Locally-checkable validation of a contract WASM module before deployment (#44).
 *
 * Deployment failures caused by malformed WASM are costly to diagnose after an
 * upload attempt reaches the network. This validator performs every check that
 * does not require I/O — buffer presence, size, the WASM magic and version
 * headers, and a structural walk of the section table — so a corrupt or
 * truncated module is rejected with an actionable, field-named error before
 * any RPC or Horizon call.
 *
 * `buildContractDeploy` runs these same checks; call this directly from a
 * deployment script to fail before you spend a build:
 *
 * ```ts
 * import { validateContractWasm } from "sorokit-core";
 * const wasm = fs.readFileSync("contract.wasm");
 * const check = validateContractWasm(wasm);
 * if (check.status === "error") {
 *   console.error(check.error.message);
 *   process.exit(1);
 * }
 * ```
 *
 * The validator never throws and never performs I/O; it is safe to call from a
 * synchronous pre-flight step.
 */

import { ok, err, SorokitErrorCode } from "../shared/response";
import type { SorokitResult } from "../shared/response";

/** Maximum accepted WASM byte length (Stellar's 256 KB deploy limit). */
export const MAX_WASM_SIZE = 256 * 1024;

// WASM magic number: 0x00 0x61 0x73 0x6d ("\0asm").
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
// WASM version 1 — the only version the binary format defines (0x01 0x00 0x00 0x00).
const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];
const WASM_HEADER_LENGTH = 8;
// Highest section id defined by the WebAssembly binary format. Section 0 is
// the custom section (may repeat); sections 1-12 are the known sections.
const MAX_KNOWN_SECTION_ID = 12;

/** Outcome of a successful WASM validation. */
export interface ValidatedContractWasm {
  /** Byte length of the validated buffer. */
  byteLength: number;
  /** Number of sections found in the module (custom sections included). */
  sectionCount: number;
}

/**
 * Read an unsigned LEB128 u32 starting at `offset`.
 *
 * @throws when the encoding is truncated or encodes a value outside the u32 range.
 * @returns the decoded value and the offset immediately after the final byte.
 */
function readU32Leb128(
  bytes: Uint8Array,
  offset: number,
): { value: number; nextOffset: number } {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[cursor];
    if (byte === undefined) {
      throw new Error("truncated section length encoding");
    }
    cursor += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      // Final byte. On the 5th byte only the low 4 bits are valid for a u32.
      if (i === 4 && (byte & 0xf0) !== 0) {
        throw new Error("section length exceeds the 32-bit range");
      }
      return { value: result >>> 0, nextOffset: cursor };
    }
    shift += 7;
  }
  // Five continuation bytes means the value does not fit in a u32.
  throw new Error("section length exceeds the 32-bit range");
}

/**
 * Validate that a buffer is a structurally well-formed WebAssembly module small
 * enough to deploy, without performing any I/O.
 *
 * Checks, in order: that the input is a `Buffer`; that it is non-empty; that it
 * is within {@link MAX_WASM_SIZE}; that it begins with the WASM magic and
 * version-1 header; and that every section declares an id in the valid range
 * and a length that fits inside the remaining buffer, that no known section
 * repeats, and that the buffer ends exactly after the last section (no trailing
 * garbage). Each failure returns a `TX_BUILD_FAILED` error whose message names
 * the specific problem and how to interpret it.
 *
 * @param contractCode - Compiled contract WASM (e.g. `fs.readFileSync(path)`)
 * @returns The validated module metadata, or a typed error
 */
export function validateContractWasm(
  contractCode: Buffer,
): SorokitResult<ValidatedContractWasm> {
  if (!Buffer.isBuffer(contractCode)) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Contract WASM must be a Buffer, received ${typeof contractCode}. Pass the compiled .wasm file contents (e.g. fs.readFileSync(wasmPath)).`,
    );
  }
  if (contractCode.length === 0) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      "Contract WASM is missing or empty. Pass the compiled .wasm file contents as a Buffer (e.g. fs.readFileSync(wasmPath)).",
    );
  }
  if (contractCode.length > MAX_WASM_SIZE) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `WASM code exceeds max size of ${MAX_WASM_SIZE} bytes (received ${contractCode.length}).`,
    );
  }
  if (contractCode.length < WASM_HEADER_LENGTH) {
    return err(
      SorokitErrorCode.TX_BUILD_FAILED,
      `Invalid WASM format: file is too short to contain the magic and version header (${contractCode.length} bytes).`,
    );
  }

  for (let i = 0; i < 4; i++) {
    if (contractCode[i] !== WASM_MAGIC[i]) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        "Invalid WASM format: missing magic bytes (expected 0x00 0x61 0x73 0x6d).",
      );
    }
  }
  for (let i = 0; i < 4; i++) {
    if (contractCode[4 + i] !== WASM_VERSION[i]) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        "Invalid WASM format: unsupported version. Only WASM version 1 (0x01 0x00 0x00 0x00) is supported.",
      );
    }
  }

  // Walk the section table. A Buffer is a Uint8Array, so it indexes directly.
  let offset = WASM_HEADER_LENGTH;
  let sectionCount = 0;
  const seenKnownSections = new Set<number>();
  while (offset < contractCode.length) {
    const sectionId = contractCode[offset];
    offset += 1;
    if (sectionId === undefined) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        "Invalid WASM format: truncated section header (missing section id).",
      );
    }
    if (sectionId > MAX_KNOWN_SECTION_ID) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        `Invalid WASM format: unknown section id ${sectionId} (valid ids are 0-12).`,
      );
    }

    let length: number;
    try {
      const read = readU32Leb128(contractCode, offset);
      length = read.value;
      offset = read.nextOffset;
    } catch (cause) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        `Invalid WASM format: ${(cause as Error).message}.`,
      );
    }

    const remaining = contractCode.length - offset;
    if (length > remaining) {
      return err(
        SorokitErrorCode.TX_BUILD_FAILED,
        `Invalid WASM format: section ${sectionId} declares ${length} bytes but only ${remaining} remain (truncated module).`,
      );
    }

    if (sectionId !== 0) {
      if (seenKnownSections.has(sectionId)) {
        return err(
          SorokitErrorCode.TX_BUILD_FAILED,
          `Invalid WASM format: duplicate section id ${sectionId} (each known section must appear at most once).`,
        );
      }
      seenKnownSections.add(sectionId);
    }

    offset += length;
    sectionCount += 1;
  }

  return ok({ byteLength: contractCode.length, sectionCount });
}
