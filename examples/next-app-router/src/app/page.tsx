/**
 * Next.js App Router — root page (Server Component).
 *
 * This file has no "use client" directive, so it runs only on the server.
 * It may safely import server-only utilities (e.g. server-side SDK helpers).
 * The interactive UI lives in the PaymentForm client component.
 */

import { PaymentForm } from "../components/PaymentForm";

export default function HomePage() {
  return (
    <main style={{ maxWidth: 520, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
      <h1>sorokit-core — Next.js App Router</h1>
      <p>
        This page is a <strong>Server Component</strong>. The form below is a{" "}
        <strong>Client Component</strong> that calls a server Route Handler to
        sign and submit transactions. The signing key never leaves the server.
      </p>
      <PaymentForm />
    </main>
  );
}
