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
