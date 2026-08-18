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
  if (!roleRow) throw new Error("Forbidden: admin only");
}

export async function getOptionalAdminStatus(): Promise<{ isAdmin: boolean }> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return { isAdmin: false };

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token || token.split(".").length !== 3) return { isAdmin: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return { isAdmin: false };

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();

    return { isAdmin: !roleError && Boolean(roleRow) };
  } catch {
    // This check controls optional navigation only. Missing, expired, or
    // interrupted auth must never turn the whole authenticated shell into 500.
    return { isAdmin: false };
  }
}
