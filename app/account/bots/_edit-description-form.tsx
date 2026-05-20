"use client";

import { useActionState } from "react";

import { MAX_DESCRIPTION_LENGTH } from "@/lib/limits";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";

import {
  updateDescriptionAction,
  type UpdateDescriptionState,
} from "./_actions";

const INITIAL: UpdateDescriptionState | null = null;

export function EditDescriptionForm(props: {
  botId: string;
  currentDescription: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateDescriptionAction,
    INITIAL,
  );

  const saved = state?.ok && state.botId === props.botId;
  const error =
    state && !state.ok && state.botId === props.botId ? state.message : null;

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="botId" value={props.botId} />
      <Label htmlFor={`desc-${props.botId}`}>Description</Label>
      <Textarea
        id={`desc-${props.botId}`}
        name="description"
        defaultValue={props.currentDescription ?? ""}
        maxLength={MAX_DESCRIPTION_LENGTH}
        rows={3}
        className="max-w-[560px]"
        placeholder="What does this bot do? (max 500 chars; URLs auto-redacted)"
      />
      <div className="flex flex-wrap items-center gap-3 mt-2">
        <Button
          type="submit"
          variant="neutral"
          size="sm"
          disabled={pending}
        >
          {pending ? "Saving…" : "Save description"}
        </Button>
        {saved ? (
          <span className="text-xs font-bold text-palm">Saved.</span>
        ) : null}
        {error ? (
          <span className="text-xs font-bold text-accent">{error}</span>
        ) : null}
        {state?.requestId && state.botId === props.botId ? (
          <code
            className="text-xs font-mono text-text-muted"
            title="Server request id — quote this if you report an issue"
          >
            {state.requestId.slice(0, 8)}
          </code>
        ) : null}
      </div>
    </form>
  );
}
