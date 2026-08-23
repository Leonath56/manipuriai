import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_messages",
  title: "Search messages",
  description: "Search across the signed-in user's Manipuri AI chat history for a phrase.",
  inputSchema: {
    query: z.string().trim().min(2).describe("Text to look for inside message content."),
    limit: z.number().int().min(1).max(50).default(20).describe("Maximum matches to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const escaped = query.replace(/[%_\\]/g, (m) => `\\${m}`);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("messages")
      .select("id, chat_id, role, content, created_at")
      .ilike("content", `%${escaped}%`)
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { matches: data ?? [] },
    };
  },
});
