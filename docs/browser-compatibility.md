# Browser compatibility

## Dual ESM/CJS export map and duplicate-instance safety

`sorokit-core` ships both an ESM build (`dist/index.mjs`) and a CJS build
(`dist/index.js`) declared in the `exports` map of `package.json`:

```json
{
  "exports": {
    ".": {
      "import":  "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  }
}
```

Most bundlers resolve only one of these per application. When they resolve
both — typically because one dependency uses `require()` and your app uses
`import` — two separate module instances are loaded. Each instance has its own
copy of internal singletons:

- `ConnectionPool` (`src/network/connectionPool.ts`) — doubles active-connection budgets.
- `EndpointRegistry` (`src/network/endpointRegistry.ts`) — splits endpoint state.
- `WalletStatusTracker` (`src/wallet/walletStatusTracker.ts`) — splits event listeners.

### How the duplicate-instance guard works

`src/shared/devtoolsBridge.ts` registers a shared symbol on `globalThis` the
first time the module loads:

```ts
export const SOROKIT_INSTANCE_SYMBOL = Symbol.for("sorokit-core/instance");
```

`Symbol.for` returns the **same** symbol regardless of which module instance
calls it, so a second instance can detect the first by checking `globalThis`.
When a second instance is detected it logs:

```
[sorokit-core] Duplicate SDK instance detected. Both the ESM (import) and
CJS (require) builds are loaded in the same runtime. …
```

It also dispatches a `sorokit:duplicate-instance` CustomEvent on `window` so
browser devtools extensions can surface the warning.

### How to prevent duplicate instances

#### Webpack / webpack-based tools (Create React App, Next.js)

Add an `alias` in `webpack.config.js` (or `next.config.js`) to force both
`import` and `require` paths to the same physical file:

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      "sorokit-core": require.resolve("sorokit-core"),
    },
  },
};
```

```js
// next.config.js
const path = require("path");

module.exports = {
  webpack(config) {
    config.resolve.alias["sorokit-core"] = path.resolve(
      __dirname,
      "node_modules/sorokit-core"
    );
    return config;
  },
};
```

#### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    dedupe: ["sorokit-core"],
  },
});
```

#### Rollup

```js
// rollup.config.js
export default {
  plugins: [
    nodeResolve({
      dedupe: ["sorokit-core"],
    }),
  ],
};
```

#### esbuild

```js
// build.mjs
import { build } from "esbuild";

await build({
  // esbuild resolves a single entry per package by default; set mainFields
  // to prefer the ESM build when bundling for browsers.
  mainFields: ["browser", "module", "main"],
});
```

### Verifying with validate-exports.js

`scripts/validate-exports.js` checks the built output for duplicate-instance
risk. Run it after a build:

```bash
npm run build
node scripts/validate-exports.js
```

It will warn if the ESM and CJS bundles are suspiciously similar in size (a
sign they may be identical files served under two names), and confirms that the
`SOROKIT_INSTANCE_SYMBOL` guard is present in the built output.

### Monorepo / hoisting issues

If your monorepo hoisting places `sorokit-core` in multiple `node_modules`
directories (e.g. `packages/app/node_modules/sorokit-core` and
`node_modules/sorokit-core`), the bundler will load two entirely separate
package instances, not just two module formats. The deduplication aliases above
fix this too by pointing every import to one absolute path.
