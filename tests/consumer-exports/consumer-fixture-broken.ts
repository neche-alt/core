/**
 * Negative consumer fixture (#82) — boundary case.
 *
 * This file imports a member that no declared subpath exports. It MUST fail
 * to type-check. `scripts/validate-consumer-types.js` asserts that `tsc` exits
 * non-zero on this file, proving the consumer-type validation actually catches
 * bad import paths instead of silently passing every build.
 *
 * Do not "fix" the missing import — the failure is the contract.
 */

// `sorokit-core/soroban` exists, but it has no member named
// `__consumerFixtureNonExistentExport`. A correct exports map + declaration
// build rejects this; a broken one (e.g. a wildcard `export *` or a stray
// `any`) would silently accept it.
import { __consumerFixtureNonExistentExport } from "sorokit-core/soroban";

void __consumerFixtureNonExistentExport;
