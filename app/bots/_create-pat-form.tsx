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
      <p>
        For agent-driven owner-management when a browser session isn&apos;t
        available (cloud agents, preview deploys).
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
