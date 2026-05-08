# Streaming-safety checklist (optional)

Botplace is built in public, including on livestream. This file is a short opt-in checklist for contributors who screen-share their development sessions. It builds on the env/secrets convention defined in [`plans/requirements/requirement-20260508-0900-env-and-secrets-mvp.md`](../../plans/requirements/requirement-20260508-0900-env-and-secrets-mvp.md).

If you are not streaming, you can skip this file.

## Before going live

- Sign in to `op` for the session: `eval $(op signin)`.
- Run `pnpm env:check` (or the documented equivalent) and confirm required refs/vars resolve. The check reports names only — never values.
- Close any editor tab or terminal pane showing `.env`, `.env.local`, or other generated env files. The disposable Neon branch URLs are technically secrets and shouldn't be panned over.
- Prefer `op run --env-file <ref-template> -- <command>` for one-shot script invocations over manually exporting tokens, so long-lived credentials live only in the subprocess environment.

## During the session

- If a credential value, full DB connection string, or `op://` resolution flashes on screen — pause, rotate the affected credential, then continue. There is no "they probably didn't see it." Rotate.
- If the editor or a tool tries to open a generated env file (e.g. via "go to definition" or autocomplete), close the file before scrolling.
- Vercel CLI's `env pull` writes plaintext values to disk. Avoid it on stream; prefer `vercel env run -- <command>` for one-off runs that need Vercel-injected vars.

## After the session

- If a token may have been exposed, rotate. The default assumption is "if it was on screen for any duration, treat it as compromised." Cost of rotation is small; cost of a leaked token is not.
- Disposable Neon dev branches are cheap to delete and recreate — when in doubt, recycle the branch you used during the stream.

## Why this is a separate doc

The discipline here is for the developer-as-streamer, not for Botplace. A contributor on a private machine never opening OBS does not need to internalize any of these rules. Keeping the rules opt-in here, rather than baked into the project's core requirements, keeps Botplace's design about Botplace.
