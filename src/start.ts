import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { isClientAbort } from "./lib/client-abort";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/**
 * A client that closes the tab / navigates away mid-stream makes Node emit
 * `Error: aborted`. It is not an application failure: there is no longer a
 * client to answer, so we must NOT log it or render the 500 error page
 * (rendering it is what produced the "blank screen" runtime error report).
 */
/**
 * Node's HTTP server emits `Error: aborted` from `abortIncoming` when a socket
 * closes mid-request. That is emitted outside any request handler, so the
 * middleware below can never see it — it bubbles up as an uncaught exception
 * and gets reported as a runtime error / blank screen. Swallow only that
 * specific case, once per process.
 */
declare const process:
  | {
      on?: (e: string, cb: (err: unknown) => void) => void;
      emit?: (e: string, ...args: unknown[]) => boolean;
      __abortGuard?: boolean;
    }
  | undefined;
if (typeof process !== "undefined" && process?.on && !process.__abortGuard) {
  process.__abortGuard = true;

  // Other listeners (Vite / the dev harness) already report uncaught
  // exceptions as blank-screen runtime errors, and we cannot remove them.
  // Intercept the emit itself so a client abort never reaches them.
  const originalEmit = process.emit?.bind(process);
  if (originalEmit) {
    process.emit = (event: string, ...args: unknown[]) => {
      if (
        (event === "uncaughtException" || event === "unhandledRejection") &&
        isClientAbort(args[0])
      ) {
        return true;
      }
      return originalEmit(event, ...args);
    };
  }

  process.on("uncaughtException", (err: unknown) => {
    if (isClientAbort(err)) return;
    console.error(err);
  });
  process.on("unhandledRejection", (err: unknown) => {
    if (isClientAbort(err)) return;
    console.error(err);
  });
}


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
