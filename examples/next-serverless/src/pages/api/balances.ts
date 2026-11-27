/**
 * Next.js API route — GET /api/balances?accounts=G1,G2,G3
 *
 * Batch-fetches balances for up to 10 accounts and returns them as JSON.
 * Useful for server-rendered dashboards that need multiple accounts at once.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerClient, batchGetAccounts } from "../../sorokitServer";
import { formatDisplayAmount, formatDisplayAsset } from "../../../../../src/utility";
import type { NetworkType } from "../../../../../src/network/config";
import type { AccountInfo, AssetBalance } from "../../../../../src/account/types";

interface FormattedBalance {
  assetType: string;
  assetCode: string;
  assetIssuer: string | null;
  /** Human-readable label, e.g. `"USDC · GABC…WXYZ"` or `"XLM (native)"`. */
  assetLabel: string;
  /** Precision-safe formatted amount (string-based; never lossy `Number` conversion). */
  amount: string;
}

interface FormattedAccount {
  publicKey: string;
  balances: FormattedBalance[];
}

interface BalancesResponse {
  accounts?: AccountInfo[];
  /** Presentation-ready balances: precision-safe amounts and asset code/issuer context. */
  formatted?: FormattedAccount[];
  error?: string;
}

/**
 * Convert a raw {@link AssetBalance} into a presentation-ready entry.
 *
 * Uses the string-typed `balance` field (not the lossy `balanceFloat`) so large
 * balances are never truncated by IEEE-754. Unknown asset types fall back to a
 * labelled "Unknown asset" entry rather than being dropped.
 */
function presentBalance(balance: AssetBalance): FormattedBalance {
  const asset = formatDisplayAsset({
    assetType: balance.assetType,
    assetCode: balance.assetCode,
    assetIssuer: balance.assetIssuer,
  });
  return {
    assetType: balance.assetType,
    assetCode: balance.assetCode,
    assetIssuer: balance.assetIssuer,
    assetLabel: asset.label,
    amount: formatDisplayAmount(balance.balance, { decimals: 7, group: true, trim: true }),
  };
}

function presentAccount(account: AccountInfo): FormattedAccount {
  return {
    publicKey: account.publicKey,
    balances: account.balances.map(presentBalance),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BalancesResponse>,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw = req.query["accounts"];
  const accountsParam = Array.isArray(raw) ? raw[0] : raw;

  if (!accountsParam) {
    return res.status(400).json({ error: "accounts query param is required" });
  }

  const publicKeys = accountsParam.split(",").map((k) => k.trim()).filter(Boolean);

  if (publicKeys.length > 10) {
    return res.status(400).json({ error: "Maximum 10 accounts per request" });
  }

  const network = (process.env.STELLAR_NETWORK ?? "testnet") as NetworkType;
  const client = getServerClient(network);
  const result = await batchGetAccounts(client, publicKeys);

  if (result.status === "error") {
    return res.status(502).json({ error: result.error.message });
  }

  return res.status(200).json({
    accounts: result.data,
    formatted: result.data.map(presentAccount),
  });
}
