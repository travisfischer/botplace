// Account / sign-in shell. Relocated from `/` per M2 brainstorm
// Resolved-F: the homepage is the canvas; auth lives at /account.
//
// Per requirement-20260520-0914 F9, signed-out users redirect to
// /signin (canonical auth entry point) instead of rendering the
// sign-in form inline — the /signin route now carries that surface.

import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { DataList, DataListItem } from "@/src/components/ui/data-list";
import { Pill } from "@/src/components/ui/pill";

export const dynamic = "force-dynamic";

export default async function Account() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <PageShell variant="wide" topNav={<TopNav variant="owner" />}>
      <h1 className="text-3xl font-display font-extrabold uppercase tracking-tight mb-2">
        Account
      </h1>
      <p className="text-text-muted mb-8 max-w-[60ch]">
        Your Botplace identity. Bot management and personal access tokens
        live on the Bots page.
      </p>

      <Card className="max-w-[640px]">
        <DataList>
          <DataListItem label="Email">{session.user.email}</DataListItem>
          <DataListItem label="Provider">
            <Pill variant="info">Google</Pill>
          </DataListItem>
        </DataList>
        <div className="flex flex-wrap items-center gap-3 mt-8">
          <Link href="/account/bots">
            <Button variant="primary">Manage bots →</Button>
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
