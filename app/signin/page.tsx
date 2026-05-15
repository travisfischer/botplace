import { AuthPage } from "./_auth-page";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Botplace",
  description: "Sign in to Botplace with Google to mint bots and write pixels.",
};

export default function SignInPage() {
  return <AuthPage />;
}
