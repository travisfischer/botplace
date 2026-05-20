---
date: 2026-05-20
type: review
requirement: requirement-20260520-1441-bot-message-board.md
milestone-slug: bot-message-board
status: draft
---

# Review: Per-sector bot message board

## Scope under review

One PR, eight internal phases. New per-sector forum: bot writes, threaded replies, @mention resolution, public list/detail/firehose APIs, admin soft-delete, two-pane messages UI, build docs, integration tests.

## Phases executed

| Phase | What landed |
|---|---|
| 1 | Prisma `Post` + `Reply` models with `mentionedBotIds: text[]`, `labels: text[]`, `deletedAt`, `apiKeyId` FK + Restrict cascades. Inverse relations on `Bot`/`BotApiKey`/`Sector`. Migration with GIN index on `posts.labels`. Applied via `prisma migrate deploy` against the dev branch. |
| 2 | Length caps (post title/desc/body/reply body), `LABEL_REGEX`, per-field moderation policy in `src/messages/validation.ts` (reject-on-hit for title + labels, redact-on-hit for description + body, same `[redacted]` token as pixel comments). `src/messages/mentions.ts` with `extractMentionedHandles` + `resolveMentionedBotIds`. New forum rate-limit buckets (`WRITE_BOT_FORUM_FREE`, `WRITE_BOT_FORUM_POWER`) + `checkForumWriteRateLimit` — separate from pixel buckets. 26 unit tests cover validation + mention regex edge cases. |
| 3 | `POST /api/v1/sectors/[id]/posts` + `POST /api/v1/sectors/[id]/posts/[postId]/replies`. Same shape as pixel-write: pepper check → bot-key auth → body cap → sector check → content validation → rate limit → mention resolution → DB insert. 201 + stored shape. Audit log fields for moderation events. |
| 4 | Three public reads: list (`/posts`, with `sort=recent_post\|recent_activity`, cursor on `before`, limit cap 50), detail (`/posts/[postId]`), firehose (`/messages`, `UNION ALL` posts + replies sorted by `created_at` desc, `kind` discriminator on each entry). CDN cache headers + per-IP public-read rate limit. Shared loaders in `src/messages/posts.ts`, `src/messages/replies.ts`, `src/messages/firehose.ts` consumed by both API and page surfaces. |
| 5 | `DELETE /api/v1/admin/posts/[id]` + `.../replies/[id]`. ADMIN_TOKEN-gated with the same 404-on-wrong-token shape as `revoke-key`. Soft-delete via `deletedAt`, idempotent on re-delete. AdminAuditEvent rows record `before`/`after` `deleted_at` + `idempotent` flag. |
| 6 | `app/sectors/[id]/messages/page.tsx` (list-only) + `[postId]/page.tsx` (list + detail). Responsive two-pane via CSS grid + `hidden md:block`. Client component `_list-pane.tsx` for paginated load-more; server components for `_detail-pane.tsx` + `_post-body.tsx`. `@mention` chip rendering looks up `mentionedBotIds` → handles in one DB query per detail view and linkifies matching `@<handle>` substrings. Viewer `TopNav` context slot grows a third Pill — `Messages` — linking to the current sector's messages page. |
| 7 | New `/build/messages` page in `BUILD_PAGES` registry: full curl examples, field rules table, rate-limit numbers, @mention parsing rules, content-moderation policy summary, three usage patterns (coordinator/listener/status bots). `/build/agents` aggregate gets a new "Talk to other bots" section with endpoint summaries. `/build/api` API reference table updated with the seven new endpoints. `/agents.md` aggregator picks them up automatically. |
| 8 | This review doc. Tests + build + lint clean. Status flip to `shipped` on the final commit. |

## Findings

### Schema (F1)

`Post` + `Reply` shapes match the spec. Two-table approach enforces "single-level nesting" by construction (`Reply` has no `parent_reply_id`). Restrict cascades on every FK preserve audit lineage. Inverse relations added on `Bot`, `BotApiKey`, `Sector`.

GIN index on `posts.labels` created explicitly in the migration SQL (Prisma's `type: Gin` directive does emit it, but we declare it ourselves to keep the migration self-describing).

Migration applied cleanly via `prisma migrate deploy` against the dev branch; `pnpm prisma migrate status` confirms 13 migrations applied.

### Bot writes (F2, F3)

- Pipeline mirrors the pixel-write endpoint exactly: env check → bot auth → body-size cap (16KB for posts, 8KB for replies) → JSON parse → sector lookup → content validation → rate limit → mention resolution → DB write.
- Validation runs **before** rate limit so a bot probing input shape doesn't burn tokens.
- Rate limit uses the new forum-specific bucket: FREE 1/min, POWER 1/10s burst 10. Per-IP not consulted — matches the precedent for content-moderated write paths (POWER pixel writes also skip per-IP).
- Mention resolution is a single Prisma `findMany` over `bots WHERE handle IN (…) AND status = 'ACTIVE'`. Reorders ids to match in-body appearance order so the JSON column ordering is meaningful.

### Public reads (F4, F5, F6)

- List endpoint uses a CTE with `LEFT JOIN replies` to compute `reply_count` (with `FILTER (WHERE deleted_at IS NULL)`) and `last_activity_at` (`COALESCE(MAX(r.created_at) FILTER (...), p.created_at)`) per post. Sort flips between `last_activity_at` and `created_at` via a SQL CASE — one query covers both modes.
- Detail endpoint loads the post + non-deleted replies in two queries (post + replies-for-post). Sector-id mismatch returns 404 (treat as "no such post here" rather than leaking the real sector).
- Firehose UNIONs posts + replies into a uniform `kind: "post" | "reply"` shape. Each table sorts by `(sector_id, created_at)` index before the union; outer ORDER BY merges. Limit+1 row pattern detects "more results"; cursor is the last entry's `created_at`.

### Admin soft-delete (F7, F8)

- DELETE handlers match `revoke-key` shape: bad/missing token → 404 + structured log (no DB write); good token → transactional update + AdminAuditEvent row. Idempotent: re-deleting a soft-deleted row returns `idempotent: true` and the original `deleted_at`.
- `isAuthorizedAdmin` duplicated in three admin routes now (revoke-key + posts + replies). Worth extracting to `lib/route-helpers.ts` in a follow-up; left in-place per the existing pattern.

### Content moderation (F9)

- `validatePostContent` runs the per-field policy:
  - Title: URL redact (silent), deny-list **reject** → `title_blocked`.
  - Description, body: URL redact (silent partial), deny-list **redact** → field becomes `[redacted]`.
  - Labels: strict — length, regex, URL-shaped pattern, deny-list all reject. Labels are normalized to lowercase + deduped.
- `validateReplyContent` runs body-only with the description/body policy.
- Audit metadata (`redactions`, `fieldRedacted`, `termHash`) flows into the success-log line so operators can tune the deny-list without seeing user text.
- 26 unit tests in `tests/messages/validation.test.ts` cover every error slug and every success path.

### @mention regex (F10)

- Regex source matches the bot-handle format. Leading-boundary guard `(?:^|[^a-z0-9])` keeps `email@conway.com` from matching as a mention.
- 13 unit tests in `tests/messages/mentions.test.ts` cover edge cases per R1: simple/multiple/dedupe/punctuation/email-shape/`@@conway`/consecutive `@a@b`/digit-leading-rejection/length-floor/end-of-string.
- The renderer in `_post-body.tsx` re-uses the same regex source via `new RegExp(SOURCE, "g")` (fresh instance per render to avoid the global-flag `lastIndex` state lint error).

### Rate-limit isolation (F11)

`checkForumWriteRateLimit` reads from a separate `forumFree`/`forumPower` bucket pair, prefixed `botplace:rl:forum_*`. A bot that hits the forum cap can still write pixels — verified by inspection (pixel-write reads from `bot`/`botPower`, never touches forum prefixes).

API tests use POWER-tier bots (capacity 10) so the test seed can write 3-4 messages per `it` without tripping the FREE 1/min cap.

### UI (F12, F13, F14)

- Two-pane CSS grid: `md:grid md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6`. Below `md`, list-only on `/messages` and detail-only on `/messages/[postId]` via `hidden md:block`.
- `ListPane` is a client component (paginates via `useState`). `DetailPane` is server-side, loads the post via the shared loader, resolves `mentionedBotIds → handles` in one query, passes the resolved-handle set to `PostBody` for chip rendering.
- Active list-row gets `bg-bg` highlight; inactive rows hover-`bg-bg`.
- `PostBody` renders `@<handle>` substrings as `<Link href="/bots/<handle>">` chips when the handle is in the resolved set; unresolved mentions are plain text.

### TopNav (F15)

Viewer's context slot now shows three Pills: sector name, Bots, Messages. Same hover-`shadow-flat-sm` treatment as the Bots pill from the previous PR.

### Build docs (F16)

- New `/build/messages` page covers what/why/how, with curl examples for every endpoint, field rules table, rate-limit numbers, @mention parsing rules, moderation policy summary, three usage patterns.
- `/build/agents` aggregate has a new "Talk to other bots" section with the endpoint summary + pointer to the full docs page.
- `/build/api` API reference table grew a "Message board (per-sector forum)" section with all seven endpoints.
- `/agents.md` aggregator picks up the new page automatically via `BUILD_PAGES` ordering.

### Build + tests + lint (N1, N7)

- `pnpm typecheck` clean.
- `pnpm lint` clean — only the 2 pre-existing warnings carried from main.
- `pnpm build` succeeds; route table shows all 7 new endpoints + 2 new page routes.
- `pnpm vitest run` — **488 tests pass, 1 skipped**. New: 26 validation, 13 mention, 10 API integration = 49 new tests.

### Audit grep

- No new hex literals introduced (chrome stays token-driven).
- No `style={…}` color literals introduced (UI pages consume only existing tokens + utility classes).

## Defects fixed during implementation

- Initial `Bot` type import from `@/generated/prisma` failed — Prisma's generated index doesn't re-export model row types. Replaced with an inlined `JoinedBot` interface in `src/messages/{posts,replies}.ts`.
- `MENTION_REGEX` declared at module scope tripped a React immutability lint rule (the global flag's `lastIndex` is mutated by `.exec`). Replaced with `new RegExp(SOURCE, "g")` per render so the stateful instance is local.
- API integration tests originally seeded FREE-tier bots; the 1/min forum cap was hit on the second write in each test. Switched to POWER-tier seed (capacity 10).
- `PATH_TEMPLATE` const in the post-create route was unused (logging uses the templated path string inline). Removed.

## Open follow-ups (not in scope here)

- **Extract `isAuthorizedAdmin`** to `lib/route-helpers.ts` — now duplicated across `revoke-key`, `posts/[id]`, `replies/[id]`. Pure refactor; defer.
- **Reply-count denormalization** on `Post` — current list query does a `LEFT JOIN replies + GROUP BY` per request. At sector-1's volume (single digits) this is fine; at scale, denormalize `reply_count` + `last_activity_at` columns updated from the reply-create transaction.
- **Cursor stability under sub-millisecond ties** — `created_at` cursors could tie in extreme volume. Adding an `id` tiebreaker to the cursor (`?before=<iso>&before_id=<id>`) is straightforward when needed.
- **Label-filter query parameter** (`?label=<label>`). GIN index is already in place; just needs a query-param wire-up in the list endpoint.
- **Mobile two-pane polish** beyond the responsive switch (gesture-friendly back-nav, swipe-between-posts). Out of scope per the requirement.

## Verdict

All phases land cleanly. Schema discipline holds, per-field moderation matches the spec table, rate-limit bucket isolation verified, soft-delete consistency tested end-to-end, UI consumes existing design-system primitives only. Ready to merge.

Requirement status flips `ready` → `shipped` on the merge commit with `shipped: 2026-05-20` added to the frontmatter.
