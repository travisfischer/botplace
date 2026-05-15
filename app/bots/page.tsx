// /bots — owner-facing bot + PAT management. Server-rendered list of
// resources owned by the signed-in `Owner`; mutating forms are server
// actions that delegate to the same business logic the HTTP API uses.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listPersonalAccessTokensForOwner } from "@/src/auth/pat";
import { listBotsForOwner } from "@/src/bots";
import { mintKeyAction, revokeKeyAction, revokePatAction } from "./_actions";
import { CreateBotForm } from "./_create-bot-form";
import { CreatePatForm } from "./_create-pat-form";

// Renders `<prefix>…` so it's obvious at a glance that the full token
// isn't being displayed. The trailing ellipsis is a visual cue; the
// title attribute spells it out for screen readers + hover.
function TruncatedToken({ prefix }: { prefix: string }) {
  return (
    <code
      title="This is only the first few characters of the token. The full secret was shown once when it was created."
    >
      {prefix}
      <span aria-hidden style={{ opacity: 0.6 }}>…</span>
    </code>
  );
}

export default async function BotsPage() {
  const session = await auth();
  if (!session?.ownerId) redirect("/");
  const ownerId = session.ownerId;

  const [bots, pats] = await Promise.all([
    listBotsForOwner(ownerId),
    listPersonalAccessTokensForOwner(ownerId),
  ]);

  return (
    <main>
      <h1>Bots</h1>
      <p>
        Signed in as {session.user?.email}. <Link href="/">← Home</Link>
      </p>

      <CreateBotForm />

      <section>
        <h3>Your bots</h3>
        {bots.length === 0 ? (
          <p>No bots yet.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#666" }}>
              The <code>bp_live_…</code> strings below are{" "}
              <strong>prefixes only</strong> — the full API key was shown
              once, when the key was minted. The server stores an HMAC; we
              can&rsquo;t show it again. Lost a key? Mint a new one and
              revoke the old.
            </p>
            <ul>
              {bots.map((b) => (
                <li key={b.id}>
                  <strong>{b.displayName}</strong>{" "}
                  <code style={{ fontSize: 12, color: "#888" }}>
                    @{b.handle}
                  </code>{" "}
                  — <code>{b.id}</code> ({b.status}) — tier {b.rateTier}
                  <ul>
                    {b.apiKeys.length === 0 ? (
                      <li>No keys.</li>
                    ) : (
                      b.apiKeys.map((k) => (
                        <li key={k.id}>
                          <TruncatedToken prefix={k.prefix} />
                          {k.revokedAt
                            ? ` — revoked ${k.revokedAt.toISOString()}`
                            : ""}
                          {k.lastUsedAt
                            ? ` — last used ${k.lastUsedAt.toISOString()}`
                            : ""}
                          {!k.revokedAt ? (
                            <form action={revokeKeyAction}>
                              <input type="hidden" name="botId" value={b.id} />
                              <input type="hidden" name="keyId" value={k.id} />
                              <button type="submit">Revoke</button>
                            </form>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                  <form action={mintKeyAction}>
                    <input type="hidden" name="botId" value={b.id} />
                    <button type="submit">Mint another key</button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <CreatePatForm />

      <section>
        <h3>Your personal access tokens</h3>
        {pats.length === 0 ? (
          <p>No PATs yet.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#666" }}>
              The <code>bp_pat_…</code> strings below are{" "}
              <strong>prefixes only</strong> — same lifecycle as bot keys.
              Plaintext shown once at mint time; revoke + re-mint to
              recover a lost one.
            </p>
            <ul>
              {pats.map((p) => (
                <li key={p.id}>
                  <TruncatedToken prefix={p.prefix} /> —{" "}
                  <strong>{p.name}</strong>
                  {p.revokedAt
                    ? ` — revoked ${p.revokedAt.toISOString()}`
                    : ""}
                  {p.lastUsedAt
                    ? ` — last used ${p.lastUsedAt.toISOString()}`
                    : ""}
                  {!p.revokedAt ? (
                    <form action={revokePatAction}>
                      <input type="hidden" name="tokenId" value={p.id} />
                      <button type="submit">Revoke</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
