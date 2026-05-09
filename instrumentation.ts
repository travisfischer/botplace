// Next.js boot hook. Runs once at server startup, before any request is
// served. Used to gate the secrets contract: in production, refuse to
// start if any required env var is missing.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertSecretsPresent } = await import("@/lib/secrets");
    assertSecretsPresent();
  }
}
