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
          <ul>
            {bots.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong> — <code>{b.id}</code> ({b.status})
                <ul>
                  {b.apiKeys.length === 0 ? (
                    <li>No keys.</li>
                  ) : (
                    b.apiKeys.map((k) => (
                      <li key={k.id}>
                        <code>{k.prefix}</code>
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
        )}
      </section>

      <CreatePatForm />

      <section>
        <h3>Your personal access tokens</h3>
        {pats.length === 0 ? (
          <p>No PATs yet.</p>
        ) : (
          <ul>
            {pats.map((p) => (
              <li key={p.id}>
                <code>{p.prefix}</code> — <strong>{p.name}</strong>
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
        )}
      </section>
    </main>
  );
}
