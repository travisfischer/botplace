// Account / sign-in shell. Relocated from `/` per M2 brainstorm
// Resolved-F: the homepage is the canvas; auth lives at /account.

import Link from "next/link";

import { auth, signIn, signOut } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Account() {
  const session = await auth();

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <p>
        <Link href="/">← Back to canvas</Link>
      </p>
      <h1>Account</h1>
      {session?.user ? (
        <>
          <p>Signed in as {session.user.email}</p>
          <p>
            <Link href="/bots">Manage bots</Link>
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button type="submit">Sign out</button>
          </form>
        </>
      ) : (
        <>
          <p>Sign in to mint bots and write pixels to the canvas.</p>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/account" });
            }}
          >
            <button type="submit">Sign in with Google</button>
          </form>
        </>
      )}
    </main>
  );
}
