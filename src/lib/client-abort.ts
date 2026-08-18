type ErrorLike = {
  name?: string;
  code?: string;
  message?: string;
  cause?: unknown;
};

export function isClientAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const value = error as ErrorLike;
  if (
    value.name === "AbortError" ||
    value.code === "ECONNRESET" ||
    value.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    /aborted|premature close|connection reset/i.test(value.message ?? "")
  ) {
    return true;
  }

  return value.cause !== error && isClientAbort(value.cause);
}