export async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  
  // Check public.user_roles table directly with service role if RPC fails or as primary check
  const { data: roleRow, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  
  if (error) throw new Error(error.message);
  if (!hasRole) throw new Error("Forbidden: admin only");
}
