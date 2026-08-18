import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/**
 * A client that closes the tab / navigates away mid-stream makes Node emit
 * `Error: aborted`. It is not an application failure: there is no longer a
 * client to answer, so we must NOT log it or render the 500 error page
 * (rendering it is what produced the "blank screen" runtime error report).
 */
const isClientAbort = (error: unknown) => {
  const e = error as { name?: string; code?: string; message?: string } | null;
  if (!e || typeof e !== "object") return false;
  return (
    e.name === "AbortError" ||
    e.code === "ECONNRESET" ||
    e.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    e.message === "aborted" ||
    /aborted|premature close|connection reset/i.test(e.message ?? "")
  );
};

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  // Internal /lovable/* routes authenticate themselves — never intercept them.
  if (request && new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (isClientAbort(error) || request?.signal?.aborted) {
      // 499 = client closed request; nothing is delivered anyway.
      return new Response(null, { status: 499 });
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
