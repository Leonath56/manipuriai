import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Show a destination-shaped placeholder almost immediately instead of
    // freezing on the current page while the next one loads.
    defaultPendingMs: 60,
    defaultPendingMinMs: 220,
  });

  return router;
};
