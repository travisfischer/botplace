// Coarse relative-time formatter used by the bot profile page and its
// activity feed. Falls all the way through to "N yr ago" rather than
// switching to an absolute timestamp — the profile-page activity log
// shows arbitrarily-old history and the row's `title` attribute
// already carries the full ISO timestamp on hover.
//
// The viewer's pixel-inspect overlay uses a different formatter
// (`formatRelativeTime` in `src/viewer/pixel-inspect.tsx`) that does
// switch to absolute after 24 hours; that surface shows recent writes
// only and the absolute timestamp is more useful there.

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hr ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} mo ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} yr ago`;
}
