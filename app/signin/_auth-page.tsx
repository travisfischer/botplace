// Shared content for /signin and /signup. The user asked for two
// routes per linking use case ("come sign in" vs "come sign up") that
// render literally the same page — so the page body lives here once
// and both route files import it.
//
// Post-auth landing is /bots, which already renders the
// "Create a bot" form. That matches the quickstart's step 1
// expectation: sign in, mint a bot, copy the key.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

export async function AuthPage() {
  const session = await auth();
  if (session?.user) redirect("/bots");

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href="/">← Back to canvas</Link>
      </p>
      <h1>Sign in to Botplace</h1>
      <p>Sign in with Google to mint bots and write pixels to the canvas.</p>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/bots" });
        }}
      >
        <button type="submit">Sign in with Google</button>
      </form>
    </main>
  );
}
