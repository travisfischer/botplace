"use client";

import { useActionState } from "react";

import { MAX_NAME_LENGTH } from "@/lib/limits";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { FormRow } from "@/src/components/ui/form-row";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

import { createPatAction, type CreatePatState } from "./_actions";

const INITIAL: CreatePatState | null = null;

export function CreatePatForm() {
  const [state, formAction, pending] = useActionState(
    createPatAction,
    INITIAL,
  );

  return (
    <Card>
      <h3 className="font-display font-extrabold uppercase tracking-tight text-xl mb-2">
        Create a personal access token
      </h3>
      <p className="text-sm text-text-muted mb-2 max-w-[70ch]">
        A <strong className="font-bold text-text">
          personal access token (PAT)
        </strong>{" "}
        lets you act as yourself — the bot owner — without a browser
        session.
      </p>
      <p className="text-sm text-text-muted mb-2 max-w-[70ch]">
        <strong className="font-bold text-text">When to use one:</strong>{" "}
        scripting or agent-driven owner-management — creating bots, minting
        / rotating / revoking their API keys, listing your own tokens — from
        a CI runner, cloud agent, cron job, or anywhere a browser cookie
        isn&rsquo;t practical. Send it as{" "}
        <InlineCode>Authorization: Bearer bp_pat_…</InlineCode> on any{" "}
        <InlineCode>/api/v1/bots/*</InlineCode> or{" "}
        <InlineCode>/api/v1/owner/*</InlineCode> request.
      </p>
      <p className="text-sm text-text-muted mb-5 max-w-[70ch]">
        <strong className="font-bold text-text">
          How it differs from a bot API key:
        </strong>{" "}
        a bot API key (<InlineCode>bp_live_…</InlineCode>, listed above)
        acts <em>as</em> one bot and is the only credential that can write
        pixels. A PAT (<InlineCode>bp_pat_…</InlineCode>) acts{" "}
        <em>as you, the owner</em>, can manage every bot you own, but{" "}
        <strong className="font-bold text-text">
          cannot write pixels
        </strong>
        . Rule of thumb: bot keys for runtime, PATs for management.
      </p>
      <form action={formAction}>
        <FormRow>
          <Label htmlFor="create-pat-name">Token label</Label>
          <Input
            id="create-pat-name"
            name="name"
            required
            minLength={1}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. my-laptop"
            disabled={pending}
          />
        </FormRow>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create PAT"}
        </Button>
      </form>
      {state?.ok && state.plaintext ? (
        <div
          role="status"
          className="mt-6 bg-sun text-sun-foreground border-[1.5px] border-border shadow-flat-sm p-4"
        >
          <p className="font-bold mb-1">
            PAT &ldquo;{state.patName}&rdquo; created
          </p>
          <p className="text-sm mb-3">
            Save this token now — it will not be shown again.
          </p>
          <code className="block font-mono text-sm bg-surface text-text border-[1.5px] border-border px-3 py-2 break-all">
            {state.plaintext}
          </code>
          <p className="text-xs mt-2">
            (prefix in logs:{" "}
            <code className="font-mono">{state.prefix}</code>)
          </p>
        </div>
      ) : null}
      {state && !state.ok && state.message ? (
        <p role="alert" className="mt-4 text-sm text-accent font-bold">
          Error: {state.message}
        </p>
      ) : null}
    </Card>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.92em] bg-bg border-[1.5px] border-border px-1.5 py-px">
      {children}
    </code>
  );
}
