"use client";

import { useActionState } from "react";

import { MAX_NAME_LENGTH } from "@/lib/limits";
import { createPatAction, type CreatePatState } from "./_actions";

const INITIAL: CreatePatState | null = null;

export function CreatePatForm() {
  const [state, formAction, pending] = useActionState(
    createPatAction,
    INITIAL,
  );

  return (
    <section>
      <h3>Create a personal access token</h3>
      <p style={{ marginBottom: 6 }}>
        A <strong>personal access token (PAT)</strong> lets you act as
        yourself — the bot owner — without a browser session.
      </p>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        <strong>When to use one:</strong> scripting or agent-driven
        owner-management — creating bots, minting / rotating / revoking
        their API keys, listing your own tokens — from a CI runner,
        cloud agent, cron job, or anywhere a browser cookie isn&rsquo;t
        practical. Send it as <code>Authorization: Bearer bp_pat_…</code>{" "}
        on any <code>/api/v1/bots/*</code> or{" "}
        <code>/api/v1/owner/*</code> request.
      </p>
      <p style={{ fontSize: 13, color: "#666", marginTop: 0 }}>
        <strong>How it differs from a bot API key:</strong> a bot API key
        (<code>bp_live_…</code>, listed above) acts <em>as</em> one bot
        and is the only credential that can write pixels. A PAT
        (<code>bp_pat_…</code>) acts <em>as you, the owner</em>, can
        manage every bot you own, but <strong>cannot write pixels</strong>.
        Rule of thumb: bot keys for runtime, PATs for management.
      </p>
      <form action={formAction}>
        <input
          name="name"
          required
          minLength={1}
          maxLength={MAX_NAME_LENGTH}
          placeholder="token label, e.g. my-laptop"
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create PAT"}
        </button>
      </form>
      {state?.ok && state.plaintext ? (
        <div role="status">
          <p>
            <strong>PAT &quot;{state.patName}&quot; created.</strong> Save this
            token now — it will not be shown again.
          </p>
          <p>
            <code>{state.plaintext}</code>
          </p>
          <p>(prefix in logs: {state.prefix})</p>
        </div>
      ) : null}
      {state && !state.ok && state.message ? (
        <p role="alert">Error: {state.message}</p>
      ) : null}
    </section>
  );
}
