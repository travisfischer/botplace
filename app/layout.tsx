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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
