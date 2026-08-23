import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listChatsTool from "./tools/list-chats";
import getChatMessagesTool from "./tools/get-chat-messages";
import searchMessagesTool from "./tools/search-messages";
import createChatTool from "./tools/create-chat";
import getProfileTool from "./tools/get-profile";

const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "manipuriai",
  title: "ManipuriAi",
  version: "0.1.0",
  instructions:
    "Tools for Manipuri AI, a bilingual Meiteilon/English assistant. Use `list_chats` and `get_chat_messages` to read the signed-in user's conversations, `search_messages` to find past discussions, `create_chat` to start a new conversation, and `get_profile` for their plan and language preference.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listChatsTool, getChatMessagesTool, searchMessagesTool, createChatTool, getProfileTool],
});
