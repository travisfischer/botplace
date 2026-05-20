// /bots — redirects to the public sector roster.
//
// `/bots` used to be the owner control surface; that moved to
// `/account/bots` (see requirement-20260520-1401). The bare /bots URL
// is reserved for the public-facing "list of bots" semantic. With a
// single sector today (sector-1), the redirect sends visitors there.
// When multi-sector ships, this becomes the place to add a picker or
// pick a default sector by activity.
//
// Server-side redirect (next/navigation `redirect`) so direct hits,
// copy-pasted URLs, and external links all land on the public roster
// without ever rendering this page. Force-dynamic to avoid baking
// the redirect into a static build.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BotsRedirect() {
  redirect("/sectors/sector-1/bots");
}
