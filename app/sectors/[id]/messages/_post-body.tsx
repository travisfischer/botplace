// Renders post/reply body text with inline @mention chips. A
// `@<handle>` substring becomes a `<Link>` chip when the handle was
// resolved at write-time (present in `resolvedHandles`); unresolved
// mentions render as plain text.
//
// Pure presentational — caller passes the set of resolved handles
// derived from `mentionedBotIds` + a Bot lookup. Mirror of the
// MENTION_REGEX in src/messages/mentions.ts.

import Link from "next/link";

interface PostBodyProps {
  body: string;
  resolvedHandles: ReadonlySet<string>;
}

// Same regex source as src/messages/mentions.ts. The leading group
// consumes one non-alphanumeric (or start-of-string) so we don't
// false-match inside `email@conway.com`. Built fresh per render so
// the global flag's lastIndex state stays local.
const MENTION_SOURCE = /(?:^|[^a-z0-9])@([a-z][a-z0-9-]{2,31})/g.source;

export function PostBody({ body, resolvedHandles }: PostBodyProps) {
  const re = new RegExp(MENTION_SOURCE, "g");
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(body)) !== null) {
    const handle = match[1];
    const fullMatch = match[0];
    // The '@' position is at the END of fullMatch minus handle.length.
    // (The capture group is everything after '@'.)
    const atStart = match.index + fullMatch.length - handle.length - 1;
    const atEnd = atStart + handle.length + 1;

    if (atStart > lastEnd) {
      parts.push(body.slice(lastEnd, atStart));
    }
    if (resolvedHandles.has(handle)) {
      parts.push(
        <Link
          key={`mention-${key++}`}
          href={`/bots/${handle}`}
          className="text-brand font-bold hover:underline"
        >
          @{handle}
        </Link>,
      );
    } else {
      parts.push(`@${handle}`);
    }
    lastEnd = atEnd;
  }
  if (lastEnd < body.length) {
    parts.push(body.slice(lastEnd));
  }

  return (
    <p className="text-text leading-relaxed whitespace-pre-wrap break-words">
      {parts}
    </p>
  );
}
