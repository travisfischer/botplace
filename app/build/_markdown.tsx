// Server component wrapping react-markdown with viewer-style typography.
// All the /build/* pages render their content through this. Theme A's
// choice to colocate markdown as TS string constants means the same
// source serves the rendered HTML, /api/build-md/<slug>, and
// /agents.md — no source-of-truth drift.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MD_STYLE: React.CSSProperties = {
  // Use system font, viewer-aligned colors. Keep h2/h3 pulled-up on
  // top margin so the content reads as a continuous flow rather than
  // disconnected sections.
};

interface MarkdownContentProps {
  source: string;
}

export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <div style={MD_STYLE} className="md-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              {...props}
              style={{ color: "#508cd7" }}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...props }) => {
            // Inline code (no language) gets a subtle pill; fenced
            // code blocks (with language) keep block styling via
            // the parent <pre> tag styled below.
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  {...props}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    fontSize: "0.9em",
                  }}
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
            <pre
              style={{
                background: "#1a1a26",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                padding: "12px 14px",
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: "16px 0",
                paddingLeft: 12,
                borderLeft: "3px solid #508cd7",
                opacity: 0.85,
              }}
            >
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: 13,
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                textAlign: "left",
                padding: "6px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.2)",
                fontWeight: 600,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: "6px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {children}
            </td>
          ),
          h1: ({ children }) => (
            <h1 style={{ marginTop: 32, fontSize: 28 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ marginTop: 28, fontSize: 22 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ marginTop: 22, fontSize: 17 }}>{children}</h3>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
