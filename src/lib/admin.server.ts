export async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  
  // Use the has_role function via admin client for strict verification
  const { data: hasRole, error } = await supabaseAdmin.rpc("has_role", { 
    _user_id: userId, 
    _role: "admin" 
  });
  
  if (error) throw new Error(error.message);
  if (!hasRole) throw new Error("Forbidden: admin only");
}
