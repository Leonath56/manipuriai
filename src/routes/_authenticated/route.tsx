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
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.user) {
      return { user: session.user };
    }

    // Attempt to refresh if session is missing/expired but refresh token exists in storage
    const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
    
    if (refreshedSession?.user) {
      return { user: refreshedSession.user };
    }

    throw redirect({ to: "/auth" });
  },
  component: () => <Outlet />,
});
