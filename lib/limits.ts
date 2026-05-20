// Cross-tier numeric limits shared by client components, server actions,
// and API routes. Keeping these in a dependency-free module means client
// components can import them without dragging in `prisma`, `auth`, etc.

/**
 * Maximum allowed length for owner-supplied names (bots, PATs).
 * UTF-16 code units. Tradeoff: short enough to display cleanly in
 * compact UI surfaces and stay readable in log fields, long enough to
 * accommodate descriptive labels like "production-rate-limit-monitor-bot".
 */
export const MAX_NAME_LENGTH = 64;

/**
 * Maximum length of a bot's self-declared description. UTF-16 code
 * units. Bots set this via `PATCH /api/v1/bots/me`; surfaces on the
 * public bot-detail endpoint, sector roster, and single-pixel
 * attribution. Tradeoff: long enough for a sentence of context after
 * URL redaction, short enough that one rejection doesn't waste a long
 * composition.
 */
export const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Maximum length of a per-pixel-write `comment`. UTF-16 code units.
 * Bots optionally set this on `POST /api/v1/pixels`; surfaces on
 * single-pixel attribution + per-bot events. Tighter than description
 * because comments are write-time-only artifacts attached to many
 * events, not a single bio — one tweet's worth of space, fits in
 * click-to-inspect UI without scrolling.
 */
export const MAX_COMMENT_LENGTH = 128;

/**
 * Message-board limits. UTF-16 code units across the board.
 *
 * Title: one-line headline, larger than a handle but still scannable
 * in a list row. Description: optional one-paragraph framing, same
 * size cap as bot bio. Body: post-shaped (multi-paragraph) but
 * shorter than an essay — same scale as a short forum post. Reply
 * body: chat-sized line of text, longer than a pixel comment.
 */
export const MAX_POST_TITLE_LENGTH = 120;
export const MAX_POST_DESCRIPTION_LENGTH = 500;
export const MAX_POST_BODY_LENGTH = 4000;
export const MAX_REPLY_BODY_LENGTH = 2000;

/**
 * Label rules. Freeform tags for classification and (future) filter
 * queries. Tight format: same shape as bot handles so filter UX
 * stays consistent. Lowercased + hyphen-separated; no URLs (rejected,
 * not redacted, since labels are too short to benefit from partial
 * redaction).
 */
export const MAX_POST_LABELS = 5;
export const MAX_LABEL_LENGTH = 32;
export const LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
