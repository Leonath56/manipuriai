/*
 * Shared bounds for user-attached images.
 *
 * The composer checked file size in the browser and the API checked nothing, so
 * the real server-side limit was "whatever a request body can carry" — including
 * on the public guest route, which has no account behind it and forwards
 * straight to a paid provider. These constants and this validator are the single
 * definition both sides use.
 *
 * Deliberately free of React and server-only imports so route handlers and
 * components can share it.
 */

/** Largest single image, decoded. Matches what the composer tells the user. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Largest combined image payload in one request, decoded. */
export const MAX_IMAGES_TOTAL_BYTES = 12 * 1024 * 1024;

const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Longest plausible `data:image/…;base64` header, used to bound the slice below. */
const MAX_HEADER_CHARS = 64;

/** How many bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type ImageInputResult = { ok: true; images: string[] } | { ok: false; reason: string };

/**
 * Validate the `images` field of a chat request.
 *
 * Only `data:` URLs are accepted. Allowing `http(s):` would turn the chat
 * endpoint into a fetch proxy: the provider dereferences whatever URL we hand
 * it, from its own network, on an anonymous caller's behalf.
 *
 * Nothing here decodes the payload — it is forwarded to the provider verbatim —
 * so the cost is a bounded header parse plus one linear scan per image, with an
 * early exit on the first bad character.
 */
export function validateImageInputs(
  input: unknown,
  opts: { maxCount: number; maxBytes?: number; maxTotalBytes?: number },
): ImageInputResult {
  if (input == null) return { ok: true, images: [] };
  if (!Array.isArray(input)) return { ok: false, reason: "Attachments must be a list of images." };
  if (input.length > opts.maxCount) {
    return { ok: false, reason: `Too many images — up to ${opts.maxCount} per message.` };
  }

  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const maxTotal = opts.maxTotalBytes ?? MAX_IMAGES_TOTAL_BYTES;
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  const images: string[] = [];
  let total = 0;

  for (const raw of input) {
    if (typeof raw !== "string" || raw.length === 0) {
      return { ok: false, reason: "That attachment isn't a readable image." };
    }

    const comma = raw.indexOf(",");
    if (comma <= 0 || comma > MAX_HEADER_CHARS) {
      return { ok: false, reason: "Only image files can be attached, not links." };
    }
    // Bounded by the check above, so slicing is safe even when the payload is
    // megabytes long.
    const header = raw.slice(0, comma).toLowerCase();
    if (!header.startsWith("data:")) {
      return { ok: false, reason: "Only image files can be attached, not links." };
    }
    const [mime, ...params] = header.slice(5).split(";");
    if (!params.includes("base64") || !ALLOWED_IMAGE_MIME.has(mime)) {
      return { ok: false, reason: "Only PNG, JPEG, WebP or GIF images can be attached." };
    }

    const b64 = raw.slice(comma + 1);
    if (!b64 || /[^A-Za-z0-9+/=]/.test(b64)) {
      return { ok: false, reason: "That image didn't upload correctly. Try attaching it again." };
    }

    const bytes = base64Bytes(b64);
    if (bytes > maxBytes) {
      return { ok: false, reason: `Each image must be under ${mb(maxBytes)} MB.` };
    }
    total += bytes;
    if (total > maxTotal) {
      return {
        ok: false,
        reason: `Those images are too large together — keep the total under ${mb(maxTotal)} MB.`,
      };
    }

    images.push(raw);
  }

  return { ok: true, images };
}
