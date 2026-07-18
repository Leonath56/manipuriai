import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useState } from "react";
import { Check, Copy } from "lucide-react";

export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-display prose-p:leading-relaxed prose-pre:bg-transparent prose-pre:p-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !className;
            if (isInline) {
              return <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em]" {...props}>{children}</code>;
            }
            return <CodeBlock language={match?.[1] ?? "text"}>{String(children).replace(/\n$/, "")}</CodeBlock>;
          },
          a(props) {
            return <a {...props} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-muted/60">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{language}</span>
        <button onClick={copy} className="flex items-center gap-1 hover:text-foreground">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code>{children}</code></pre>
    </div>
  );
}
