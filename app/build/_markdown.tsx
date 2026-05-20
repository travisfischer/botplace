// Server component wrapping react-markdown with token-driven prose
// styling. All the /build/* pages render their content through this.
// Theme A's choice to colocate markdown as TS string constants means
// the same source serves the rendered HTML, /api/build-md/<slug>, and
// /agents.md — no source-of-truth drift.
//
// Per requirement-20260520-0914 F12: font-display headings, font-mono
// code, --brand links, --surface code-fence backgrounds with --border
// ink borders.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  source: string;
}

export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <div className="md-content text-text leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              {...props}
              className="text-brand font-bold hover:underline"
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={
                href?.startsWith("http") ? "noopener noreferrer" : undefined
              }
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  {...props}
                  className="font-mono text-[0.9em] bg-bg border-[1.5px] border-border px-1.5 py-px"
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="font-mono text-[13px] leading-[1.55] bg-bg border-[1.5px] border-border shadow-flat-sm p-3.5 my-5 overflow-x-auto">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 pl-3.5 border-l-[3px] border-brand text-text-muted">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto border-[1.5px] border-border my-5">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-bg border-b-[1.5px] border-border">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="text-left px-3 py-2 font-bold uppercase tracking-[0.08em] text-xs text-text-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 align-top border-t-[1.5px] border-border first:border-t-0">
              {children}
            </td>
          ),
          h1: ({ children }) => (
            <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl mt-10 mb-4 leading-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mt-8 mb-3 leading-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-display font-bold uppercase tracking-tight text-base mt-6 mb-2 leading-tight">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-3 pl-6 list-disc marker:text-text-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 pl-6 list-decimal marker:text-text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="my-1">{children}</li>,
          hr: () => <hr className="my-8 border-0 h-px bg-border" />,
          strong: ({ children }) => (
            <strong className="font-bold text-text">{children}</strong>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
