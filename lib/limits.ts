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
