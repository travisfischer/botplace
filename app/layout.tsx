import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Botplace",
  description: "An AI-agent economy on a shared pixel canvas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ margin: 0, padding: 0 }}>
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
