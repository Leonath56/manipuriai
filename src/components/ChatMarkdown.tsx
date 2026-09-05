import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { memo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "./ui/button";
import { mayekClass } from "@/lib/script";
import { toast } from "sonner";

export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    /*
     * `dark:prose-invert` only started working once `<html>` gained the `dark`
     * class (see __root.tsx) — before that the typography plugin was styling
     * markdown for a light background on a dark app.
     *
     * `break-words` + `[overflow-wrap:anywhere]`: an unbroken token longer than
     * the column — a long URL, a hash, a file path — used to push the whole
     * message wider than the viewport and give the page a horizontal scrollbar.
     *
     * A reply written in Meitei Mayek gets the Mayek family and its taller
     * leading (see lib/script.ts). Without it, a whole answer in ꯃꯤꯇꯩ ꯃꯌꯦꯛ
     * rendered with the marks above and below the baseline colliding — and on
     * iOS and macOS in a face with no Meetei Mayek coverage at all.
     */
    <div className={`${mayekClass(content) ?? ""} prose prose-sm max-w-none break-words text-foreground/95 [overflow-wrap:anywhere]
      prose-p:leading-relaxed prose-p:my-3 prose-p:text-foreground/90
      prose-headings:font-display prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-3
      prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
      prose-a:text-gold prose-a:font-medium prose-a:underline prose-a:decoration-gold/30 prose-a:underline-offset-2 hover:prose-a:decoration-gold
      prose-strong:text-foreground prose-strong:font-semibold
      prose-ul:my-3 prose-ol:my-3
      prose-li:my-1 prose-li:text-foreground/90 prose-li:marker:text-muted-foreground
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-4
      prose-th:bg-muted/40 prose-th:px-3.5 prose-th:py-2 prose-th:text-[13px] prose-th:font-semibold prose-th:text-foreground
      prose-td:px-3.5 prose-td:py-2 prose-td:border-t prose-td:border-border prose-td:text-foreground/90 prose-td:align-top
      prose-blockquote:border-l-2 prose-blockquote:border-gold/50 prose-blockquote:bg-muted/25 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-md prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:font-normal
      prose-hr:my-7 prose-hr:border-border
      prose-img:rounded-xl prose-img:border prose-img:border-border
      dark:prose-invert`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !className;

            if (isInline) {
              return (
                <code className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-foreground" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock language={match?.[1] ?? "text"}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },
          table({ children }) {
            return (
              // Tables scroll inside their own box rather than widening the
              // message. On a phone a 5-column table is otherwise unreadable.
              <div className="scrollbar-thin my-5 w-full overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-sm">{children}</table>
              </div>
            );
          },
          ul({ children }) { return <ul className="list-disc space-y-1 pl-5">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal space-y-1 pl-5">{children}</ol>; },
          a({ href, children, ...props }) {
            // Links here are model output, so they can be steered by anything the
            // model read — a pasted page, a tool result. react-markdown already
            // drops javascript: URLs, but an in-tab navigation would still carry
            // the user out of a live conversation, and a bare target="_blank"
            // would hand the destination a usable window.opener. Open in a new
            // tab, severed, and don't lend the app's ranking to it.
            return (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access");
    }
  };

  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-border bg-[oklch(0.15_0.005_65)]">
      {/*
        The header used to be `md:opacity-0 md:group-hover:opacity-100`, so on
        desktop the language label and the Copy button were both invisible until
        you happened to hover — and permanently invisible to anyone navigating by
        keyboard. It stays visible; it is 32px of quiet chrome.
      */}
      <div className="flex items-center justify-between border-b border-border bg-white/[0.03] px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-mono">{language}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          aria-label={copied ? "Code copied" : "Copy code"}
          className="-mr-1 h-7 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-gold" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </div>

      <SyntaxHighlighter
        language={language.toLowerCase()}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: "1rem 1.1rem",
          fontSize: "0.84rem",
          lineHeight: "1.65",
          background: "transparent",
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
          },
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}