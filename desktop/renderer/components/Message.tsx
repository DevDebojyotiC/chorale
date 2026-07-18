import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/** Recursively pull plain text out of rendered (possibly highlight-span'd) children — for copy. */
function toText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? toText(props.children) : "";
}

function CopyBtn({ getText, label = "copy", className = "copybtn" }: { getText: () => string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(getText());
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "✓ copied" : label}
    </button>
  );
}

/** Assistant messages render as markdown with highlighted, copyable code; user messages stay plain. */
export const Message = memo(function Message({ text, markdown }: { text: string; markdown: boolean }) {
  if (!markdown) return <div className="body user">{text}</div>;
  return (
    <div className="body md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <>{children}</>, // the code renderer supplies its own <pre>
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const isBlock = Boolean(match) || toText(children).includes("\n");
            if (!isBlock) {
              return (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="codeblock">
                <div className="codeblock-h">
                  <span className="lang">{match?.[1] ?? "text"}</span>
                  <CopyBtn getText={() => toText(children)} className="codecopy" />
                </div>
                <pre>
                  <code className={className}>{children}</code>
                </pre>
              </div>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export { CopyBtn };
