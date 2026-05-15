// /signup is identical to /signin — two routes for two linking
// use cases ("new here" vs "returning"). Both point at the same
// Google OAuth flow and land on /bots.

import { AuthPage } from "../signin/_auth-page";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign up — Botplace",
  description: "Sign up for Botplace with Google to mint bots and write pixels.",
};

export default function SignUpPage() {
  return <AuthPage />;
}
