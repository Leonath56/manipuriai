/**
 * Conversation export.
 *
 * Entirely client-side: the messages are already in the database under the user's
 * own row-level-security policy, so exporting is a read the user is allowed to do
 * plus a Blob — no new endpoint, no server work, and nothing leaves the browser.
 *
 * Two formats, because they answer different questions. Markdown is for reading
 * and sharing a conversation; JSON is for keeping your own copy of your data.
 */

export type ExportMessage = {
  role: string;
  content: string;
  created_at?: string;
};

/**
 * Attachments and generated images are stored inline as base64 data URLs. Left in
 * place a single exported chat would be tens of megabytes of unreadable text, so
 * they become a note in the Markdown version. The JSON version keeps the raw
 * content — it is the "all of my data" format, and truncating it there would be a
 * lie about what was saved.
 */
function stripInlineImages(content: string): string {
  return content
    .replace(/```image-generation\n[\s\S]*?\n```/g, "_[generated image]_")
    .replace(/!\[[^\]]*\]\(data:[^)]*\)/g, "_[image attachment]_")
    .trim();
}

function stamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function toMarkdown(title: string, messages: ExportMessage[]): string {
  const lines: string[] = [`# ${title || "Untitled chat"}`, "", `Exported from Manipuri AI · ${new Date().toLocaleString()}`, ""];
  for (const m of messages) {
    const who = m.role === "user" ? "You" : "Manipuri AI";
    const when = stamp(m.created_at);
    lines.push("---", "", `### ${who}${when ? ` · ${when}` : ""}`, "", stripInlineImages(m.content) || "_(empty)_", "");
  }
  return lines.join("\n");
}

export function toJson(title: string, messages: ExportMessage[]): string {
  return JSON.stringify(
    {
      title: title || "Untitled chat",
      exported_at: new Date().toISOString(),
      source: "Manipuri AI",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        created_at: m.created_at ?? null,
      })),
    },
    null,
    2,
  );
}

/** Filesystem-safe, and readable — a Meitei Mayek title shouldn't become "____". */
export function exportFilename(title: string, ext: "md" | "json"): string {
  const base = (title || "manipuri-ai-chat")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `${base || "manipuri-ai-chat"}-${date}.${ext}`;
}

/** Triggers a download without leaving the page. */
export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously cancels the download in
  // Safari, which reads the blob after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadConversation(
  title: string,
  messages: ExportMessage[],
  format: "md" | "json",
): void {
  if (format === "json") {
    downloadTextFile(exportFilename(title, "json"), toJson(title, messages), "application/json");
  } else {
    downloadTextFile(exportFilename(title, "md"), toMarkdown(title, messages), "text/markdown");
  }
}
