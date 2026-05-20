import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Silkscreen } from "next/font/google";
import { Providers } from "@/src/components/providers";
import "./globals.css";

// Hanken Grotesk — display + body. Variable font (no `weight` needed).
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

// JetBrains Mono — code, bot identifiers, API. Variable font.
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Silkscreen — wordmark ONLY. Era signal scoped to one element. Static font,
// weights must be enumerated.
const silkscreen = Silkscreen({
  subsets: ["latin"],
  variable: "--font-silkscreen",
  weight: ["400", "700"],
  display: "swap",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hanken.variable} ${jetbrains.variable} ${silkscreen.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
