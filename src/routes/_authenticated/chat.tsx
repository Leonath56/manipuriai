import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthedShell } from "@/components/AuthedShell";

export const Route = createFileRoute("/_authenticated/chat")({
  component: () => (
    <AuthedShell>
      <Outlet />
    </AuthedShell>
  ),
});
