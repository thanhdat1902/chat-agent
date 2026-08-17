"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant replies come back as markdown — headings, bold, quoted draft
 * emails, tables of numbers. Rendering them as plain text showed the raw
 * `**` and `>` characters, which made good answers look broken.
 *
 * Raw HTML is not enabled, so model output cannot inject markup.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 leading-relaxed">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 leading-relaxed">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-[3px] border-[var(--line)] bg-[#f8fafc] py-1.5 pl-3 pr-2 text-[13px] italic text-[#3d444b]">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h3 className="text-[15px] font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="text-[14px] font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="text-[13px] font-semibold">{children}</h4>,
          code: ({ children, className }) =>
            className?.includes("language-") ? (
              <code className="block overflow-x-auto rounded bg-[#f1f3f5] p-2.5 font-mono text-[12px]">
                {children}
              </code>
            ) : (
              <code className="rounded bg-[#f1f3f5] px-1 py-[1px] font-mono text-[12.5px]">
                {children}
              </code>
            ),
          pre: ({ children }) => <pre className="overflow-x-auto">{children}</pre>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--accent)] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-[var(--line)] bg-[#f8fafc] px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-[var(--line)] px-2 py-1">{children}</td>
          ),
          hr: () => <hr className="border-[var(--line)]" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
