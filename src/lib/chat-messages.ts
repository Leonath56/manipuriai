import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
};

/**
 * Shared by route preloading and the conversation screen so a new chat can
 * warm the exact cache entry the destination consumes before navigation.
 */
export function chatMessagesQueryOptions(chatId: string, staleTime = 15_000) {
  return queryOptions({
    queryKey: ["messages", chatId] as const,
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
    staleTime,
  });
}