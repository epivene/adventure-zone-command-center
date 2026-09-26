import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Render model text as React elements. Raw HTML stays disabled, and model
// images are labels rather than automatic requests to third-party servers.
export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_p+p]:mt-4 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-teal-600 [&_blockquote]:pl-4 [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.9em] [&_h1]:mb-2 [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div
              role="region"
              aria-label="Scrollable table"
              tabIndex={0}
              className="my-3 max-w-full overflow-x-auto rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <table className="w-full border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children, style }) => (
            <th
              style={style}
              className="min-w-32 border-b bg-slate-100 px-3 py-2 align-top font-semibold"
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td style={style} className="min-w-32 border-b px-3 py-2 align-top">
              {children}
            </td>
          ),
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 underline underline-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt || "Image"}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
