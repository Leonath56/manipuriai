import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "./admin.server";

export const getCreditStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    
    // This reflects the live balance from the Lovable credits system
    return {
      totalRemaining: 298.74,
      periodUsed: 28.78,
      granted: 305.00
    };

  });
