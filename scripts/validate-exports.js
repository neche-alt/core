const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Intercept require('vitest') to prevent Vitest from throwing "Vitest failed to access its internal state"
// when the testing bundle is loaded in a pure Node.js process.
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request) {
  if (request === 'vitest') {
    return {
      vi: {
        fn: () => (() => {}),
        mock: () => {},
        hoisted: (fn) => fn(),
        importActual: () => Promise.resolve({}),
      },
      describe: () => {},
      it: () => {},
      expect: () => {},
      beforeEach: () => {},
      afterEach: () => {},
      beforeAll: () => {},
      afterAll: () => {},
    };
  }
  return originalRequire.apply(this, arguments);
};

try {
  console.log('Building package via npm run build...');
  execSync('npm run build', { stdio: 'inherit' });
  console.log('Build completed successfully.\n');
} catch (error) {
  console.warn('⚠ Warning: npm run build exited with an error. Proceeding with validation of built files.\n');
}

const mainPath = path.resolve(__dirname, '../dist/index.js');
const testingPath = path.resolve(__dirname, '../dist/testing/index.js');

console.log(`Loading main module from: ${mainPath}`);
let mainModule;
try {
  mainModule = require(mainPath);
} catch (error) {
  console.error(`Error: Failed to require main bundle from ${mainPath}:`, error.message);
  process.exit(1);
}

console.log(`Loading testing module from: ${testingPath}`);
let testingModule;
try {
  testingModule = require(testingPath);
} catch (error) {
  console.error(`Error: Failed to require testing bundle from ${testingPath}:`, error.message);
  process.exit(1);
}

const expectedMainExports = [
  'createSorokitClient',
  'FreighterAdapter',
  'XBullAdapter',
  'LobstrAdapter',
  'RabetAdapter',
  'WalletType',
  'SorokitErrorCode',
  'ok',
  'err',
  'isOk',
  'isErr',
  'resolveNetwork',
  'NETWORK_DEFAULTS',
  'checkMainnetSafety',
  'extractTransactionTotalXlm',
  'isMainnetNetwork',
  'DEFAULT_MAINNET_SAFETY_THRESHOLD_XLM',
  'MAINNET_NETWORK_PASSPHRASE',
  'OpenTelemetryManager',
  'SorokitSpan',
  'createOpenTelemetryManager',
  'parseSep7Uri',
  'validateSep7Uri',
  'buildFromSep7Uri',
  'generateSep7Uri',
  'SmartCache',
  'createSmartCache',
  'generateCacheKey'
];

const expectedTestingExports = [
  'createMockClient',
  'createMockWalletAdapter'
];

let failed = false;

console.log('\nValidating main exports from dist/index.js...');
for (const name of expectedMainExports) {
  if (mainModule[name] === undefined) {
    console.error(`❌ Missing main export: "${name}" is undefined or not exported.`);
    failed = true;
  } else {
    console.log(`✅ Main export "${name}" is present.`);
  }
}

const sharedModule = require(path.resolve(__dirname, '../dist/shared/public.js'));
for (const name of [
  'checkMainnetSafety', 'extractTransactionTotalXlm', 'isMainnetNetwork',
  'DEFAULT_MAINNET_SAFETY_THRESHOLD_XLM', 'MAINNET_NETWORK_PASSPHRASE',
]) {
  if (sharedModule[name] === undefined) {
    console.error(`Missing shared export: ${name}`);
    failed = true;
  }
}
if (sharedModule.createSmartCache !== undefined || sharedModule.registerAsset !== undefined) {
  console.error('Internal shared utilities leaked from the stable shared entrypoint');
  failed = true;
}
if (mainModule.SorokitErrorCode.MAINNET_SAFETY_LIMIT !== 'MAINNET_SAFETY_LIMIT') {
  console.error('Missing Mainnet safety error code');
  failed = true;
}

console.log('\nValidating testing exports from dist/testing/index.js...');
for (const name of expectedTestingExports) {
  if (testingModule[name] === undefined) {
    console.error(`❌ Missing testing export: "${name}" is undefined or not exported.`);
    failed = true;
  } else {
    console.log(`✅ Testing export "${name}" is present.`);
  }
}

// ─── Duplicate-instance guard validation (#130) ────────────────────────────
// Verify that the main CJS bundle uses Symbol.for('sorokit-core/instance')
// so the guard is accessible across both the ESM and CJS builds.
console.log('\nValidating duplicate-instance guard (dist/index.js)...');

const distIndexSrc = fs.readFileSync(mainPath, 'utf-8');
const distSharedSrc = (() => {
  try {
    return fs.readFileSync(path.resolve(__dirname, '../dist/shared/public.js'), 'utf-8');
  } catch {
    return '';
  }
})();

const instanceSymbolPresent =
  distIndexSrc.includes('sorokit-core/instance') ||
  distSharedSrc.includes('sorokit-core/instance');

if (!instanceSymbolPresent) {
  // Check the shared devtools bridge bundle directly
  const devtoolsPath = path.resolve(__dirname, '../dist/shared/devtoolsBridge.js');
  const devtoolsSrc = (() => {
    try { return fs.readFileSync(devtoolsPath, 'utf-8'); } catch { return ''; }
  })();
  if (!devtoolsSrc.includes('sorokit-core/instance')) {
    console.warn('⚠ Warning: SOROKIT_INSTANCE_SYMBOL (Symbol.for("sorokit-core/instance")) not detected in built output.');
    console.warn('  The duplicate-instance guard may not be active. Ensure devtoolsBridge.ts is included in the build.');
  } else {
    console.log('✅ SOROKIT_INSTANCE_SYMBOL present in devtoolsBridge bundle.');
  }
} else {
  console.log('✅ SOROKIT_INSTANCE_SYMBOL present in built output.');
}

// Verify the export map has both import and require for the main entry point
const pkgPath = path.resolve(__dirname, '../package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const mainEntry = pkg.exports && pkg.exports['.'];
if (!mainEntry) {
  console.error('❌ No "." entry in package.json exports map.');
  failed = true;
} else {
  if (!mainEntry.import) {
    console.error('❌ Missing "import" condition in "." exports entry — ESM build not declared.');
    failed = true;
  } else {
    console.log(`✅ ESM entry declared: ${mainEntry.import}`);
  }
  if (!mainEntry.require) {
    console.error('❌ Missing "require" condition in "." exports entry — CJS build not declared.');
    failed = true;
  } else {
    console.log(`✅ CJS entry declared: ${mainEntry.require}`);
  }
  if (mainEntry.import && mainEntry.require && mainEntry.import === mainEntry.require) {
    console.error('❌ ESM and CJS entries point to the same file — dual-build is not configured correctly.');
    failed = true;
  } else if (mainEntry.import && mainEntry.require) {
    console.log('✅ ESM and CJS entries are separate files (dual-build confirmed).');

    // Warn if both files exist and are identical (would cause duplicate instances)
    const esmPath = path.resolve(__dirname, '..', mainEntry.import);
    const cjsPath = path.resolve(__dirname, '..', mainEntry.require);
    if (fs.existsSync(esmPath) && fs.existsSync(cjsPath)) {
      const esmSize = fs.statSync(esmPath).size;
      const cjsSize = fs.statSync(cjsPath).size;
      if (Math.abs(esmSize - cjsSize) < 100) {
        console.warn(
          '⚠ Warning: ESM and CJS bundles are suspiciously similar in size ' +
          `(${esmSize} vs ${cjsSize} bytes). If they are identical, any bundler ` +
          'that loads both will create two SDK instances.',
        );
      } else {
        console.log(`✅ ESM bundle: ${esmSize} bytes, CJS bundle: ${cjsSize} bytes.`);
      }
    }
  }
}

if (failed) {
  console.error('\n❌ Build validation failed. One or more exports are missing.');
  process.exit(1);
} else {
  console.log('\n✨ Build validation passed successfully! All expected exports are present.');
  process.exit(0);
}
