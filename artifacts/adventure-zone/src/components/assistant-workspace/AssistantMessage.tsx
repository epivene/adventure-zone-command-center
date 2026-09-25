import Markdown from "react-markdown";

// Render model text as React elements. Raw HTML stays disabled, and model
// images are labels rather than automatic requests to third-party servers.
export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words [overflow-wrap:anywhere] [&_p]:whitespace-pre-wrap [&_p+p]:mt-4 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-teal-600 [&_blockquote]:pl-4 [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.9em] [&_h1]:mb-2 [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold">
      <Markdown
        skipHtml
        components={{
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
