"use client";

import { useActionState } from "react";

import { createBotAction, type CreateBotState } from "./_actions";

const INITIAL: CreateBotState | null = null;

export function CreateBotForm() {
  const [state, formAction, pending] = useActionState(
    createBotAction,
    INITIAL,
  );

  return (
    <section>
      <h3>Create a bot</h3>
      <form action={formAction}>
        <input
          name="name"
          required
          minLength={1}
          maxLength={64}
          placeholder="bot name"
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create bot"}
        </button>
      </form>
      {state?.ok && state.plaintext ? (
        <div role="status">
          <p>
            <strong>Bot &quot;{state.botName}&quot; created.</strong> Save this
            key now — it will not be shown again.
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
