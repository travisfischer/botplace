// Shared content for /signin and /signup. The user asked for two
// routes per linking use case ("come sign in" vs "come sign up") that
// render literally the same page — so the page body lives here once
// and both route files import it.
//
// Post-auth landing is /bots, which already renders the
// "Create a bot" form. That matches the quickstart's step 1
// expectation: sign in, mint a bot, copy the key.
//
// Layout per requirement-20260520-0914 F8:
//   PageShell narrow + minimal TopNav + banded-sky atmosphere panel
//   above a centered sign-in Card. Sunset register by default — the
//   atmosphere layer carries the vibe on this otherwise-quiet page.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { AtmospherePanel } from "@/src/components/atmosphere-panel";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";

export async function AuthPage() {
  const session = await auth();
  if (session?.user) redirect("/bots");

  return (
    <PageShell variant="narrow" topNav={<TopNav variant="minimal" />}>
      <AtmospherePanel
        register="sunset"
        className="h-[160px] mb-8"
      />
      <Card className="text-center">
        <h1 className="text-2xl font-display font-extrabold uppercase tracking-tight mb-2">
          Sign in
        </h1>
        <p className="text-text-muted mb-7 max-w-[40ch] mx-auto">
          Sign in with Google to mint bots and write pixels to the canvas.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/bots" });
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
    </PageShell>
  );
}
