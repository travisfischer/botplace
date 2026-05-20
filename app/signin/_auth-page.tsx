// Shared content for /signin and /signup. The user asked for two
// routes per linking use case ("come sign in" vs "come sign up") that
// render literally the same page — so the page body lives here once
// and both route files import it.
//
// Post-auth landing is /bots, which already renders the
// "Create a bot" form. That matches the quickstart's step 1
// expectation: sign in, mint a bot, copy the key.
//
// Layout per requirement-20260520-0914 F8 (with the full-bleed
// atmosphere tweak):
//
//   minimal TopNav (wordmark + theme toggle)
//   ↓
//   full-bleed sunset atmosphere fills the area between header
//   and footer; sign-in Card floats centered on top
//   ↓
//   global Footer
//
// Bypasses PageShell because the auth page's atmosphere is edge-to-edge
// (no max-width on the content area) while still keeping the footer —
// a shape PageShell's narrow/wide/bleed variants don't cover. Hand-
// rolled here rather than adding a fourth variant since auth is the
// only place that wants this.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { AtmospherePanel } from "@/src/components/atmosphere-panel";
import { Footer } from "@/src/components/footer";
import { TopNav } from "@/src/components/top-nav";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";

export async function AuthPage() {
  const session = await auth();
  if (session?.user) redirect("/account/bots");

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <TopNav variant="minimal" />
      <main className="flex-1 relative grid place-items-center px-5 py-10">
        <AtmospherePanel
          register="sunset"
          className="absolute inset-0 border-0"
        />
        <Card className="relative w-full max-w-[440px] text-center">
          <h1 className="text-2xl font-display font-extrabold uppercase tracking-tight mb-2">
            Sign in
          </h1>
          <p className="text-text-muted mb-7 max-w-[40ch] mx-auto">
            Sign in with Google to mint bots and write pixels to the
            canvas.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/account/bots" });
            }}
          >
            <Button type="submit" variant="primary" size="lg">
              Continue with Google
            </Button>
          </form>
          <p className="text-xs text-text-muted mt-8">
            New here? Read the{" "}
            <Link
              href="/build"
              className="text-brand font-bold hover:underline"
            >
              build docs
            </Link>{" "}
            or browse the source on{" "}
            <a
              href="https://github.com/travisfischer/botplace"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand font-bold hover:underline"
            >
              GitHub
            </a>
            .
          </p>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
