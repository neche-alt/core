/**
 * Consumer type fixture for every declared package subpath (#82).
 *
 * Declaration generation can succeed while a consumer's import path or the
 * peer types for an individual published subpath still fail. This fixture is
 * compiled against the built package (the declaration files under `dist/`)
 * resolved through the `exports` map in `package.json`, so it fails at
 * release-validation time the moment a subpath's `types` condition points at a
 * declaration that is not generated, re-exported, or peer-compatible.
 *
 * Each subpath is exercised with both a runtime value import and a type-only
 * import, because either can break independently of the other. Values are
 * referenced only to prove they exist on the published surface; types are
 * referenced in a `| null` annotation that is always assignable, so the fixture
 * does not depend on any runtime constructor shape and remains a pure compile
 * check.
 *
 * This file is type-checked only (see `tsconfig.json` in this directory); it is
 * never bundled or executed. The release validation pipeline
 * (`scripts/validate-exports.js`) and `scripts/validate-consumer-types.js`
 * compile it with `tsc --noEmit` against a `node_modules/sorokit-core` symlink
 * to this package root, so module resolution goes through the real `exports`
 * field exactly as a consumer's would.
 */

// Root entry point — the main barrel.
import { createSorokitClient, ok, err, SorokitErrorCode } from "sorokit-core";
import type { SorokitResult } from "sorokit-core";

void createSorokitClient;
void ok;
void err;
void SorokitErrorCode;
const _rootResult: SorokitResult<number> | null = null;
void _rootResult;

// ./core — client construction only (no wallet/Soroban surface).
import { createSorokitClient as createSorokitClientFromCore } from "sorokit-core/core";
import type { SorokitClient, SorokitClientConfig } from "sorokit-core/core";

void createSorokitClientFromCore;
const _coreClient: SorokitClient | null = null;
const _coreConfig: SorokitClientConfig | null = null;
void _coreClient;
void _coreConfig;

// ./testing — mock client + wallet adapter for unit tests.
import { createMockClient, createMockWalletAdapter } from "sorokit-core/testing";
import type { MockClientConfig } from "sorokit-core/testing";

void createMockClient;
void createMockWalletAdapter;
const _testingConfig: MockClientConfig | null = null;
void _testingConfig;

// ./wallet — adapters, connection, and wallet types.
import { FreighterAdapter, WalletType, connectWallet } from "sorokit-core/wallet";
import type { WalletAdapter } from "sorokit-core/wallet";

void FreighterAdapter;
void WalletType;
void connectWallet;
const _walletAdapter: WalletAdapter | null = null;
void _walletAdapter;

// ./account — account, balances, and streaming helpers.
import { getBalances, streamAccount } from "sorokit-core/account";
import type { AccountInfo, AssetBalance } from "sorokit-core/account";

void getBalances;
void streamAccount;
const _accountInfo: AccountInfo | null = null;
const _accountBalance: AssetBalance | null = null;
void _accountInfo;
void _accountBalance;

// ./transaction — memo, fee, and submission helpers.
import { createTextMemo, estimateFee } from "sorokit-core/transaction";
import type { SorokitMemo } from "sorokit-core/transaction";

void createTextMemo;
void estimateFee;
const _txMemo: SorokitMemo | null = null;
void _txMemo;

// ./soroban — contract invoke/read, deploy validation, and event streaming.
import {
  invokeContract,
  validateDeployConfig,
  subscribeContractEvents,
  DEFAULT_RECOVERY_WINDOW_MS,
} from "sorokit-core/soroban";
import type { ContractInvokeParams, ContractEvent } from "sorokit-core/soroban";

void invokeContract;
void validateDeployConfig;
void subscribeContractEvents;
void DEFAULT_RECOVERY_WINDOW_MS;
const _sorobanParams: ContractInvokeParams | null = null;
const _sorobanEvent: ContractEvent | null = null;
void _sorobanParams;
void _sorobanEvent;

// ./network — network resolution, circuit breaker, and rate limiting.
import { resolveNetwork, NETWORK_DEFAULTS } from "sorokit-core/network";
import type { NetworkType } from "sorokit-core/network";

void resolveNetwork;
void NETWORK_DEFAULTS;
const _networkType: NetworkType | null = null;
void _networkType;

// ./shared — stable public helpers (a curated subset of shared internals).
import { formatAmount, xlmToStroops } from "sorokit-core/shared";
import type { FormatAmountOptions } from "sorokit-core/shared";

void formatAmount;
void xlmToStroops;
const _sharedOptions: FormatAmountOptions | null = null;
void _sharedOptions;

// ./integration — SEP anchors, federation, and key management.
import {
  resolveFederatedAddress,
  authenticateSep10,
} from "sorokit-core/integration";
import type { AnchorAsset } from "sorokit-core/integration";

void resolveFederatedAddress;
void authenticateSep10;
const _integrationAsset: AnchorAsset | null = null;
void _integrationAsset;

// ./lazy — deferred module loading and federation.
import { loadModule, isLazyModuleName, LAZY_MODULES } from "sorokit-core/lazy";
import type { LazyModuleName } from "sorokit-core/lazy";

void loadModule;
void isLazyModuleName;
void LAZY_MODULES;
const _lazyName: LazyModuleName | null = null;
void _lazyName;

// ./compliance — audit trail and compliance reporting.
import { createAuditTrail, recordOperation } from "sorokit-core/compliance";
import type { AuditRecord } from "sorokit-core/compliance";

void createAuditTrail;
void recordOperation;
const _complianceRecord: AuditRecord | null = null;
void _complianceRecord;

// ./utility — address/amount validation and rate limiting.
import { validateAddress, createRateLimiter } from "sorokit-core/utility";
import type { RateLimiterOptions } from "sorokit-core/utility";

void validateAddress;
void createRateLimiter;
const _utilityRateLimitOptions: RateLimiterOptions | null = null;
void _utilityRateLimitOptions;
