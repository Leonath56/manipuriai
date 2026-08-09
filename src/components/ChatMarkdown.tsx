import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo, useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "./ui/button";

export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none 
      prose-p:leading-relaxed prose-p:my-2 
      prose-headings:font-display prose-headings:font-semibold prose-headings:text-foreground/90 
      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
      prose-strong:text-foreground/90 prose-strong:font-bold
      prose-ul:my-2 prose-ol:my-2 
      prose-li:my-0.5
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-transparent prose-pre:p-0 prose-pre:my-3
      prose-table:border prose-table:border-border/40
      prose-th:bg-muted/30 prose-th:px-3 prose-th:py-2 prose-th:text-xs prose-th:uppercase prose-th:tracking-wider
      prose-td:px-3 prose-td:py-2 prose-td:border-t prose-td:border-border/20
      dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !className;
            
            if (isInline) {
              return (
                <code className="rounded bg-muted/60 px-1.5 py-0.5 text-[0.85em] font-medium text-foreground/90 border border-border/20" {...props}>
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
          // Customizing table for responsiveness
          table({ children }) {
            return (
              <div className="my-4 w-full overflow-x-auto rounded-xl border border-border/30 bg-card/20 shadow-sm scrollbar-thin scrollbar-thumb-muted-foreground/20">
                <table className="w-full border-collapse text-left">
                  {children}
                </table>
              </div>
            );
          },
          // Ensure lists are clean
          ul({ children }) { return <ul className="list-disc pl-6">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal pl-6">{children}</ol>; },
          // Beautiful blockquotes
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-primary/40 bg-muted/20 px-4 py-1 italic rounded-r-lg my-4 text-muted-foreground">
                {children}
              </blockquote>
            );
          }
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
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-border/50 bg-[#282c34] shadow-md transition-all hover:shadow-lg">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 font-medium text-white/60">
          <Terminal className="h-3.5 w-3.5" />
          <span className="font-mono uppercase tracking-widest">{language}</span>
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={copy} 
          className="h-7 gap-1.5 px-2.5 text-[11px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy code</span>
            </>
          )}
        </Button>
      </div>
      
      <div className="relative">
        <SyntaxHighlighter
          language={language.toLowerCase()}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: '1.25rem',
            fontSize: '0.85rem',
            lineHeight: '1.6',
            background: 'transparent',
          }}
          codeTagProps={{
            style: {
              fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
            }
          }}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
