"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { MAX_NAME_LENGTH } from "@/lib/limits";
// Client-safe constants — `@/src/bots/handle` transitively imports the
// moderation pipeline (which reads the deny-list file at module load
// via `node:fs`), so a client-bundle import of it makes the Turbopack
// build fail. The format module exports the same constants without the
// server-only dependency chain.
import {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  HANDLE_REGEX,
} from "@/src/bots/handle-format";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { FormRow } from "@/src/components/ui/form-row";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";

import { createBotAction, type CreateBotState } from "./_actions";

const INITIAL: CreateBotState | null = null;

// React's `pattern` attribute uses ECMA RegExp source, anchored
// implicitly. Strip the regex's leading `^` and trailing `$` (the
// browser anchors) so the source string lives in the attribute as-is.
const HANDLE_PATTERN = HANDLE_REGEX.source.replace(/^\^|\$$/g, "");

// Debounce while typing rather than waiting for blur — user-perceived
// latency matters more than a few extra requests against an endpoint
// whose work is one indexed lookup. 350ms is below the threshold most
// users notice, above the threshold for typing through a 3-letter word.
const HANDLE_CHECK_DEBOUNCE_MS = 350;

type HandleCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; handle: string }
  | { state: "unavailable"; handle: string; message: string };

// Async result keeps the `handle` it answered for so a stale response
// can be ignored when the input has moved on.
type ServerCheck =
  | { state: "available"; handle: string }
  | { state: "unavailable"; handle: string; message: string }
  | null;

export function CreateBotForm() {
  const [state, formAction, pending] = useActionState(
    createBotAction,
    INITIAL,
  );
  const [handle, setHandle] = useState("");
  // Only the async server response is held in state. Synchronous slices
  // (idle / too-short / checking) are derived directly from `handle` so
  // we don't pay a render cycle to set them — and the lint rule against
  // synchronous setState in effects stays happy.
  const [serverCheck, setServerCheck] = useState<ServerCheck>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Nothing to fetch below the min length; the locally-derived hint
    // covers idle + too-short.
    if (handle.length < HANDLE_MIN_LENGTH) return;
    const ac = new AbortController();
    inFlightRef.current?.abort();
    inFlightRef.current = ac;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/public/check-handle?handle=${encodeURIComponent(handle)}`,
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        const body = (await res.json()) as
          | { available: true; handle: string }
          | {
              available: false;
              handle: string;
              reason: string;
              message: string;
            }
          | { error: string; message: string };
        if (ac.signal.aborted) return;
        if ("available" in body) {
          setServerCheck(
            body.available
              ? { state: "available", handle: body.handle }
              : {
                  state: "unavailable",
                  handle: body.handle,
                  message: body.message,
                },
          );
        } else {
          setServerCheck(null);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setServerCheck(null);
      }
    }, HANDLE_CHECK_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [handle]);

  const check: HandleCheck = (() => {
    if (handle.length === 0) return { state: "idle" };
    if (handle.length < HANDLE_MIN_LENGTH) {
      return {
        state: "unavailable",
        handle,
        message: `Handle must be at least ${HANDLE_MIN_LENGTH} characters`,
      };
    }
    if (serverCheck && serverCheck.handle === handle) return serverCheck;
    return { state: "checking" };
  })();

  const handleHint = renderHandleHint(check, handle);

  return (
    <Card>
      <h3 className="font-display font-extrabold uppercase tracking-tight text-xl mb-2">
        Add a bot
      </h3>
      <p className="text-sm text-text-muted mb-2 max-w-[60ch]">
        <strong className="font-bold text-text">Handle</strong> is your
        bot&rsquo;s globally-unique slug — it appears in attribution UIs
        and the public API. Lowercase letters, digits, and hyphens;{" "}
        {HANDLE_MIN_LENGTH}&ndash;{HANDLE_MAX_LENGTH} characters; must
        start with a letter. Persistent (no rename in M3).
      </p>
      <p className="text-sm text-text-muted mb-5 max-w-[60ch]">
        <strong className="font-bold text-text">Display name</strong> is a
        freely-editable label for your own &ldquo;my bots&rdquo; listing.
      </p>
      <form action={formAction}>
        <FormRow>
          <Label htmlFor="create-bot-handle">Handle</Label>
          <Input
            id="create-bot-handle"
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
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            aria-describedby="handle-hint"
          />
          {handleHint}
        </FormRow>
        <FormRow>
          <Label htmlFor="create-bot-display-name">Display name</Label>
          <Input
            id="create-bot-display-name"
            name="display_name"
            required
            minLength={1}
            maxLength={MAX_NAME_LENGTH}
            placeholder="My bot"
            disabled={pending}
          />
        </FormRow>
        <Button
          type="submit"
          disabled={
            pending ||
            (check.state === "unavailable" && check.handle === handle)
          }
        >
          {pending ? "Creating…" : "Create bot"}
        </Button>
      </form>
      {state?.ok && state.plaintext ? (
        <SecretReveal
          title={`Bot "${state.handle}" (${state.displayName}) created`}
          secret={state.plaintext}
          prefix={state.prefix ?? ""}
        />
      ) : null}
      {state && !state.ok && state.message ? (
        <p
          role="alert"
          className="mt-4 text-sm text-accent font-bold"
        >
          Error: {state.message}
        </p>
      ) : null}
    </Card>
  );
}

function renderHandleHint(check: HandleCheck, handle: string) {
  const baseClass = "text-xs mt-1.5 min-h-4 font-bold";
  if (check.state === "checking") {
    return <div className={`${baseClass} text-text-muted`}>Checking…</div>;
  }
  if (check.state === "available" && check.handle === handle) {
    return (
      <div className={`${baseClass} text-palm`} role="status">
        ✓ <code className="font-mono">{check.handle}</code> is available
      </div>
    );
  }
  if (check.state === "unavailable" && check.handle === handle) {
    return (
      <div className={`${baseClass} text-accent`} role="status">
        ✗ {check.message}
      </div>
    );
  }
  // Idle (empty, sub-min-length, or stale check after edit) — keep the
  // slot reserved so the form doesn't reflow when the hint appears.
  return <div className={baseClass} aria-hidden />;
}

/**
 * "Shown once — save it now" reveal block. Per requirement-20260520-0914
 * Resolved decision 3: inline reveal, not a Dialog. Sun warning ground
 * makes "you only see this once" unmissable.
 */
function SecretReveal({
  title,
  secret,
  prefix,
}: {
  title: string;
  secret: string;
  prefix: string;
}) {
  return (
    <div
      role="status"
      className="mt-6 bg-sun text-sun-foreground border-[1.5px] border-border shadow-flat-sm p-4"
    >
      <p className="font-bold mb-1">{title}</p>
      <p className="text-sm mb-3">
        Save this key now — it will not be shown again.
      </p>
      <code className="block font-mono text-sm bg-surface text-text border-[1.5px] border-border px-3 py-2 break-all">
        {secret}
      </code>
      <p className="text-xs mt-2">
        (prefix in logs: <code className="font-mono">{prefix}</code>)
      </p>
    </div>
  );
}
