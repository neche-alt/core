/**
 * Automated coverage for the consumer type fixture (#82).
 *
 * Declaration generation can succeed while a consumer import path or the peer
 * types for an individual published subpath still fail. `scripts/validate-consumer-types.js`
 * compiles a fixture against the built package through the real `exports` map
 * and asserts a broken fixture fails. This test runs that script in CI so the
 * regression cannot slip past the normal `test` job (which does not build `dist`
 * ahead of time), building the package first only when `dist/` is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const DIST_INDEX = join(ROOT, "dist", "index.d.ts");

function run(cmd: string, args: string[], timeoutMs: number): void {
  execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    timeout: timeoutMs,
    shell: process.platform === "win32",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
  });
}

describe("consumer type fixture (#82)", () => {
  beforeAll(() => {
    // The CI `test` job does not build `dist/` before running vitest, so build
    // it here only when the declarations are missing. A developer who already
    // ran `npm run build` pays no cost. A full build is used (not just
    // `tsc --emitDeclarationOnly`) so the `exports` `import`/`require` files
    // exist alongside the declarations, matching what consumers receive.
    if (!existsSync(DIST_INDEX)) {
      // eslint-disable-next-line no-console
      console.log("dist/ missing — building package for consumer type fixture…");
      run("npm", ["run", "build"], 120_000);
    }
  }, 180_000);

  it("compiles a consumer fixture importing every declared subpath through the exports map", () => {
    // Exits 0 only when the positive fixture compiles AND the negative
    // (broken) fixture fails to compile.
    expect(() =>
      run(process.execPath, [join(ROOT, "scripts", "validate-consumer-types.js")], 120_000),
    ).not.toThrow();
  }, 180_000);
});
