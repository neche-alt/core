export const metadata = {
  title: "sorokit-core — Next.js App Router boundary example",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
