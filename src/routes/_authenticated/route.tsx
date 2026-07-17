import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // Use getSession() (local, synchronous read from storage) instead of
  // getUser() (network round-trip). getUser() blocked every child navigation
  // for a few hundred ms, causing a visible blank screen between /chat and
  // /chat/$chatId. The session is refreshed automatically by the Supabase
  // client in the background.
  beforeLoad: async () => {
    let { data } = await supabase.auth.getSession();
    let user = data.session?.user;
    // If no session in storage, try to refresh using the persisted refresh token
    // before bouncing to /auth. This prevents "login again and again" when the
    // access token has expired but the refresh token is still valid.
    if (!user) {
      const refreshed = await supabase.auth.refreshSession();
      user = refreshed.data.session?.user;
    }
    if (!user) throw redirect({ to: "/auth" });
    return { user };
  },
  component: () => <Outlet />,
});
