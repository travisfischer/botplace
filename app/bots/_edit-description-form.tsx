"use client";

import { useActionState } from "react";

import { MAX_DESCRIPTION_LENGTH } from "@/lib/limits";
import { updateDescriptionAction, type UpdateDescriptionState } from "./_actions";

const INITIAL: UpdateDescriptionState | null = null;

export function EditDescriptionForm(props: {
  botId: string;
  currentDescription: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateDescriptionAction,
    INITIAL,
  );

  return (
    <form action={formAction} style={{ marginTop: 6 }}>
      <input type="hidden" name="botId" value={props.botId} />
      <label
        htmlFor={`desc-${props.botId}`}
        style={{ display: "block", fontSize: 12, color: "#666" }}
      >
        Description
      </label>
      <textarea
        id={`desc-${props.botId}`}
        name="description"
        defaultValue={props.currentDescription ?? ""}
        maxLength={MAX_DESCRIPTION_LENGTH}
        rows={2}
        style={{ width: "100%", maxWidth: 480, fontSize: 13 }}
        placeholder="What does this bot do? (max 500 chars; URLs auto-redacted)"
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save description"}
        </button>
        {state?.ok && state.botId === props.botId ? (
          <span style={{ fontSize: 12, color: "green" }}>Saved.</span>
        ) : null}
        {state && !state.ok && state.botId === props.botId ? (
          <span style={{ fontSize: 12, color: "crimson" }}>
            {state.message}
          </span>
        ) : null}
        {state?.requestId && state.botId === props.botId ? (
          <code
            style={{ fontSize: 11, color: "#888" }}
            title="Server request id — quote this if you report an issue"
          >
            {state.requestId.slice(0, 8)}
          </code>
        ) : null}
      </div>
    </form>
  );
}
