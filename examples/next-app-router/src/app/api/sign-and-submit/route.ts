/**
 * Next.js App Router route handler — POST /api/sign-and-submit
 *
 * Server-only. Imports signTransactionOffline which uses Node's `crypto`
 * module and must never reach the browser bundle.
 *
 * The signing secret key is read from an environment variable and never
 * sent to the client — only the resulting transaction hash is returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { signTransactionOffline } from "../../../../../src/wallet/signTransactionOffline";
import { createSorokitClient } from "../../../../../src/client/createSorokitClient";
import type { NetworkType } from "../../../../../src/network/config";

interface SignAndSubmitBody {
  transactionXdr: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as SignAndSubmitBody;
  const { transactionXdr } = body;

  if (!transactionXdr || typeof transactionXdr !== "string") {
    return NextResponse.json(
      { error: "transactionXdr is required" },
      { status: 400 },
    );
  }

  const secretKey = process.env.SIGNING_SECRET_KEY;
  const network = (process.env.STELLAR_NETWORK ?? "testnet") as NetworkType;

  if (!secretKey) {
    return NextResponse.json(
      { error: "SIGNING_SECRET_KEY environment variable is not set" },
      { status: 500 },
    );
  }

  const clientResult = createSorokitClient({ network });
  if (clientResult.status === "error") {
    return NextResponse.json(
      { error: `Client init failed: ${clientResult.error.message}` },
      { status: 500 },
    );
  }
  const client = clientResult.data;

  // Sign offline using the server secret — this is a Node-only operation.
  const signed = signTransactionOffline(
    transactionXdr,
    secretKey,
    client.networkConfig.networkPassphrase,
  );

  if (signed.status === "error") {
    return NextResponse.json({ error: signed.error.message }, { status: 400 });
  }

  const submitted = await client.transaction.submit(signed.data);

  if (submitted.status === "error") {
    return NextResponse.json(
      { error: submitted.error.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ hash: submitted.data.hash });
}
