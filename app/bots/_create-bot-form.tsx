"use client";

import { useActionState, useEffect, useRef, useState } from "react";

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
          | { available: false; handle: string; reason: string; message: string }
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
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            aria-describedby="handle-hint"
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
          {handleHint}
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
        <button
          type="submit"
          disabled={
            pending ||
            (check.state === "unavailable" && check.handle === handle)
          }
        >
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

function renderHandleHint(check: HandleCheck, handle: string) {
  const base = {
    id: "handle-hint",
    style: { fontSize: 12, marginTop: 4, minHeight: 16 } as const,
  };
  if (check.state === "checking") {
    return (
      <div {...base} style={{ ...base.style, color: "#888" }}>
        Checking…
      </div>
    );
  }
  if (check.state === "available" && check.handle === handle) {
    return (
      <div {...base} style={{ ...base.style, color: "#177a3a" }} role="status">
        ✓ <code>{check.handle}</code> is available
      </div>
    );
  }
  if (check.state === "unavailable" && check.handle === handle) {
    return (
      <div {...base} style={{ ...base.style, color: "#a4262c" }} role="status">
        ✗ {check.message}
      </div>
    );
  }
  // Idle (empty, sub-min-length, or stale check after edit) — keep the
  // slot reserved so the form doesn't reflow when the hint appears.
  return <div {...base} aria-hidden />;
}
