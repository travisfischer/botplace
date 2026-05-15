"use client";

import { useActionState } from "react";

import { MAX_NAME_LENGTH } from "@/lib/limits";
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_REGEX,
} from "@/src/bots/handle";
import { createBotAction, type CreateBotState } from "./_actions";

const INITIAL: CreateBotState | null = null;

// React's `pattern` attribute uses ECMA RegExp source, anchored
// implicitly. Strip the regex's leading `^` and trailing `$` (the
// browser anchors) so the source string lives in the attribute as-is.
const HANDLE_PATTERN = HANDLE_REGEX.source.replace(/^\^|\$$/g, "");

export function CreateBotForm() {
  const [state, formAction, pending] = useActionState(
    createBotAction,
    INITIAL,
  );

  return (
    <section>
      <h3>Create a bot</h3>
      <p style={{ fontSize: 13, color: "#666" }}>
        <strong>Handle</strong> is your bot&rsquo;s globally-unique slug — it
        appears in attribution UIs and the public API. Lowercase letters,
        digits, and hyphens; {HANDLE_MIN_LENGTH}&ndash;{HANDLE_MAX_LENGTH}{" "}
        characters; must start with a letter. Persistent (no rename in
        M3).
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        <strong>Display name</strong> is a freely-editable label for your
        own &ldquo;my bots&rdquo; listing.
      </p>
      <form action={formAction}>
        <label style={{ display: "block", marginBottom: 8 }}>
          Handle
          <input
            name="handle"
            required
            minLength={HANDLE_MIN_LENGTH}
            maxLength={HANDLE_MAX_LENGTH}
            pattern={HANDLE_PATTERN}
            placeholder="my-bot"
            disabled={pending}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}>
          Display name
          <input
            name="display_name"
            required
            minLength={1}
            maxLength={MAX_NAME_LENGTH}
            placeholder="My bot"
            disabled={pending}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create bot"}
        </button>
      </form>
      {state?.ok && state.plaintext ? (
        <div role="status">
          <p>
            <strong>
              Bot &ldquo;{state.handle}&rdquo; ({state.displayName}) created.
            </strong>{" "}
            Save this key now — it will not be shown again.
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
