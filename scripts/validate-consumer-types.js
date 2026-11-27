/**
 * Validate that every declared package subpath is consumable as a type (#82).
 *
 * Declaration generation (`tsc --emitDeclarationOnly`) can succeed while a
 * consumer's import path or the peer types for an individual published subpath
 * still fail. This script compiles a small consumer fixture against the BUILT
 * package through the real `package.json` `exports` map — by symlinking
 * `node_modules/sorokit-core` to this package root — so resolution matches what
 * a consumer experiences. It then asserts that a deliberately broken fixture
 * fails to compile, proving the check catches bad import paths rather than
 * silently passing.
 *
 * Precondition: `dist/` must already be built (the `exports` `types` conditions
 * point at the declaration files under `dist/`). Callers that cannot assume
 * that should run `npm run build` first; `scripts/validate-exports.js` does
 * this before calling.
 *
 * Exit code 0 = the positive fixture compiles AND the negative fixture fails.
 * Exit code 1 = either check did not behave as expected.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const NODE_MODULES = path.join(ROOT, "node_modules");
const LINK = path.join(NODE_MODULES, "sorokit-core");
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
const FIXTURE_DIR = path.join(ROOT, "tests", "consumer-exports");
const POSITIVE_CONFIG = path.join(FIXTURE_DIR, "tsconfig.json");
const NEGATIVE_CONFIG = path.join(FIXTURE_DIR, "tsconfig.broken.json");

let createdLink = false;

function ensureSymlink() {
  let existing;
  try {
    existing = fs.readlinkSync(LINK);
  } catch {
    existing = null;
  }
  if (existing !== null) {
    // A symlink already exists. If it points to this package root, reuse it;
    // otherwise refuse to clobber someone else's dependency.
    const resolved = path.resolve(path.dirname(LINK), existing);
    if (resolved !== ROOT) {
      throw new Error(
        `Refusing to overwrite existing node_modules/sorokit-core symlink (points to ${resolved}).`,
      );
    }
    createdLink = false;
    return;
  }
  // A real file/directory named sorokit-core is present — do not touch it.
  if (fs.existsSync(LINK)) {
    throw new Error(
      "Refusing to overwrite an existing node_modules/sorokit-core entry that is not our symlink.",
    );
  }
  fs.symlinkSync(ROOT, LINK, "dir");
  createdLink = true;
}

function removeSymlink() {
  if (!createdLink) return;
  try {
    fs.unlinkSync(LINK);
  } catch {
    // Best-effort cleanup; a leftover symlink to the package root is harmless.
  }
}

function runTsc(configPath, expectSuccess) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [TSC, "--noEmit", "-p", configPath], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    exitCode = error.status ?? 1;
    stdout = (error.stdout ?? "").toString();
    stderr = (error.stderr ?? "").toString();
  }

  const succeeded = exitCode === 0;
  if (succeeded !== expectSuccess) {
    const label = expectSuccess ? "compile" : "fail to compile";
    console.error(`✖ Consumer fixture was expected to ${label}, but tsc exited ${exitCode}.`);
    console.error(`  config: ${path.relative(ROOT, configPath)}`);
    if (stdout.trim()) console.error(`  stdout:\n${stdout.trim()}`);
    if (stderr.trim()) console.error(`  stderr:\n${stderr.trim()}`);
    return false;
  }
  return true;
}

function main() {
  if (!fs.existsSync(TSC)) {
    console.error("✖ TypeScript is not installed (node_modules/typescript missing). Run `npm install`.");
    process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, "dist", "index.d.ts"))) {
    console.error("✖ dist/ is not built. Run `npm run build` before validating consumer types.");
    process.exit(1);
  }
  if (!fs.existsSync(POSITIVE_CONFIG) || !fs.existsSync(NEGATIVE_CONFIG)) {
    console.error("✖ Consumer fixture tsconfigs are missing under tests/consumer-exports/.");
    process.exit(1);
  }

  let ok = true;
  try {
    ensureSymlink();

    console.log("Compiling consumer fixture against package exports (positive)…");
    ok = runTsc(POSITIVE_CONFIG, true) && ok;

    console.log("Compiling broken consumer fixture (must fail — boundary case)…");
    ok = runTsc(NEGATIVE_CONFIG, false) && ok;
  } finally {
    removeSymlink();
  }

  if (ok) {
    console.log("✓ Consumer type fixture verified: every declared subpath is consumable and bad imports are rejected.");
    process.exit(0);
  }
  process.exit(1);
}

main();
