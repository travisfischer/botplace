// /bots — owner-facing bot + PAT management. Server-rendered list of
// resources owned by the signed-in `Owner`; mutating forms are server
// actions that delegate to the same business logic the HTTP API uses.
//
// Per requirement-20260520-0914 F10: PageShell wide + owner TopNav +
// section Cards with token-driven Tables for API keys and PATs.
// Server actions in _actions.ts are unchanged — only their UI
// wrappers do.

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { listPersonalAccessTokensForOwner } from "@/src/auth/pat";
import { listBotsForOwner } from "@/src/bots";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import { Separator } from "@/src/components/ui/separator";
import {
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/src/components/ui/table";

import {
  mintKeyAction,
  revokeKeyAction,
  revokePatAction,
} from "./_actions";
import { CreateBotForm } from "./_create-bot-form";
import { CreatePatForm } from "./_create-pat-form";
import { EditDescriptionForm } from "./_edit-description-form";

export const dynamic = "force-dynamic";

// Renders `<prefix>…` so it's obvious at a glance that the full token
// isn't being displayed. The trailing ellipsis is a visual cue; the
// title attribute spells it out for screen readers + hover.
function TruncatedToken({ prefix }: { prefix: string }) {
  return (
    <code
      className="font-mono text-sm"
      title="This is only the first few characters of the token. The full secret was shown once when it was created."
    >
      {prefix}
      <span aria-hidden className="opacity-60">
        …
      </span>
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
    <PageShell variant="wide" topNav={<TopNav variant="owner" />}>
      <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-2">
        Bots
      </h1>
      <p className="text-text-muted mb-8 max-w-[60ch]">
        Mint bots, rotate their API keys, and manage the personal access
        tokens you use to script Botplace from a terminal or agent.
      </p>

      <section className="mb-12">
        <CreateBotForm />

        <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mt-10 mb-4">
          Your bots
        </h2>

        {bots.length === 0 ? (
          <Card>
            <p className="text-text-muted">
              No bots yet. Create one above and mint your first key to start
              writing pixels.
            </p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
              The <code className="font-mono">bp_live_…</code> strings below
              are <strong className="font-bold text-text">prefixes only</strong>{" "}
              — the full API key was shown once, when the key was minted. The
              server stores an HMAC; we can&rsquo;t show it again. Lost a key?
              Mint a new one and revoke the old.
            </p>
            <div className="flex flex-col gap-5">
              {bots.map((b) => (
                <Card key={b.id}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 mb-3">
                    <h3 className="font-display font-extrabold uppercase tracking-tight text-2xl leading-tight">
                      {b.displayName}
                    </h3>
                    <code className="font-mono text-sm text-text-muted">
                      @{b.handle}
                    </code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Pill variant="info" title="Rate-limit tier">
                      {b.rateTier}
                    </Pill>
                    <Pill
                      variant={b.status === "ACTIVE" ? "success" : "default"}
                    >
                      {b.status.toLowerCase()}
                    </Pill>
                    <code
                      className="font-mono text-xs text-text-muted"
                      title="Bot CUID"
                    >
                      {b.id}
                    </code>
                  </div>

                  <EditDescriptionForm
                    botId={b.id}
                    currentDescription={b.description}
                  />

                  <Separator />

                  <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-text-muted mb-3">
                    API keys
                  </h4>
                  {b.apiKeys.length === 0 ? (
                    <p className="text-sm text-text-muted">No keys.</p>
                  ) : (
                    <Table>
                      <THead>
                        <Tr>
                          <Th>Prefix</Th>
                          <Th>Status</Th>
                          <Th>Last used</Th>
                          <Th className="text-right">Action</Th>
                        </Tr>
                      </THead>
                      <TBody>
                        {b.apiKeys.map((k) => (
                          <Tr key={k.id}>
                            <Td>
                              <TruncatedToken prefix={k.prefix} />
                            </Td>
                            <Td>
                              {k.revokedAt ? (
                                <Pill>Revoked</Pill>
                              ) : (
                                <Pill variant="success">Active</Pill>
                              )}
                            </Td>
                            <Td className="text-text-muted text-sm">
                              {k.lastUsedAt
                                ? formatTimestamp(k.lastUsedAt)
                                : "Never"}
                            </Td>
                            <Td className="text-right">
                              {!k.revokedAt ? (
                                <form action={revokeKeyAction}>
                                  <input
                                    type="hidden"
                                    name="botId"
                                    value={b.id}
                                  />
                                  <input
                                    type="hidden"
                                    name="keyId"
                                    value={k.id}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    type="submit"
                                  >
                                    Revoke
                                  </Button>
                                </form>
                              ) : (
                                <span className="text-text-muted text-sm">
                                  —
                                </span>
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </TBody>
                    </Table>
                  )}
                  <form action={mintKeyAction} className="mt-4">
                    <input type="hidden" name="botId" value={b.id} />
                    <Button variant="neutral" size="sm" type="submit">
                      Mint another key
                    </Button>
                  </form>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      <section>
        <CreatePatForm />

        <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mt-10 mb-4">
          Your personal access tokens
        </h2>

        {pats.length === 0 ? (
          <Card>
            <p className="text-text-muted">No PATs yet.</p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4 max-w-[70ch]">
              The <code className="font-mono">bp_pat_…</code> strings below
              are <strong className="font-bold text-text">prefixes only</strong>{" "}
              — same lifecycle as bot keys. Plaintext shown once at mint
              time; revoke + re-mint to recover a lost one.
            </p>
            <Table>
              <THead>
                <Tr>
                  <Th>Prefix</Th>
                  <Th>Label</Th>
                  <Th>Status</Th>
                  <Th>Last used</Th>
                  <Th className="text-right">Action</Th>
                </Tr>
              </THead>
              <TBody>
                {pats.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <TruncatedToken prefix={p.prefix} />
                    </Td>
                    <Td>
                      <strong className="font-bold">{p.name}</strong>
                    </Td>
                    <Td>
                      {p.revokedAt ? (
                        <Pill>Revoked</Pill>
                      ) : (
                        <Pill variant="success">Active</Pill>
                      )}
                    </Td>
                    <Td className="text-text-muted text-sm">
                      {p.lastUsedAt ? formatTimestamp(p.lastUsedAt) : "Never"}
                    </Td>
                    <Td className="text-right">
                      {!p.revokedAt ? (
                        <form action={revokePatAction}>
                          <input
                            type="hidden"
                            name="tokenId"
                            value={p.id}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            type="submit"
                          >
                            Revoke
                          </Button>
                        </form>
                      ) : (
                        <span className="text-text-muted text-sm">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </>
        )}
      </section>
    </PageShell>
  );
}

function formatTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + "Z";
}
