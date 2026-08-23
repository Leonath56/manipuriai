import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_chat",
  title: "Create chat",
  description:
    "Create a new Manipuri AI conversation for the signed-in user, optionally seeded with a first user message.",
  inputSchema: {
    title: z.string().trim().min(1).max(120).describe("Title of the new conversation."),
    first_message: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Optional first user message stored in the new chat."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, first_message }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const userId = ctx.getUserId();
    const supabase = supabaseForUser(ctx);
    const { data: chat, error } = await supabase
      .from("chats")
      .insert({ user_id: userId, title })
      .select("id, title, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    if (first_message) {
      const { error: msgError } = await supabase
        .from("messages")
        .insert({ chat_id: chat.id, user_id: userId, role: "user", content: first_message });
      if (msgError) {
        return { content: [{ type: "text", text: msgError.message }], isError: true };
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(chat) }],
      structuredContent: { chat },
    };
  },
});
