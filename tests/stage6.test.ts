/*
 * Stage 6 regression tests for the two security decisions that are pure
 * functions, and therefore the two that can be pinned down: what counts as an
 * acceptable attached image, and which MCP hosts are refused.
 *
 * Run with `npm test` (node's built-in runner, no new dependency). Both modules
 * are imported from source so a future edit to the real validator is what gets
 * tested, not a copy of it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { base64Bytes, validateImageInputs, MAX_IMAGE_BYTES } from "../src/lib/image-input.ts";
import { isBlockedMcpHost } from "../src/lib/mcp-client.server.ts";

const png = (payload: string) => `data:image/png;base64,${payload}`;
/** A data URL whose decoded payload is `bytes` long. */
const imageOfBytes = (bytes: number) => png("A".repeat(Math.ceil(bytes / 3) * 4));

test("base64Bytes accounts for padding", () => {
  assert.equal(base64Bytes("AAAA"), 3);
  assert.equal(base64Bytes("AAA="), 2);
  assert.equal(base64Bytes("AA=="), 1);
});

test("accepts a well-formed data URL", () => {
  const r = validateImageInputs([png("iVBORw0KGgo=")], { maxCount: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.images.length, 1);
});

test("absent input is not an error", () => {
  const r = validateImageInputs(undefined, { maxCount: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.images.length, 0);
});

test("rejects a non-array", () => {
  assert.equal(validateImageInputs("not-an-array", { maxCount: 4 }).ok, false);
  assert.equal(validateImageInputs({ 0: png("AAAA") }, { maxCount: 4 }).ok, false);
});

test("rejects more images than the caller allows", () => {
  const many = Array.from({ length: 5 }, () => png("AAAA"));
  assert.equal(validateImageInputs(many, { maxCount: 4 }).ok, false);
});

test("rejects remote URLs — the provider must not be used as a fetch proxy", () => {
  for (const url of [
    "https://example.com/cat.png",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ]) {
    assert.equal(validateImageInputs([url], { maxCount: 4 }).ok, false, url);
  }
});

test("rejects a mime type outside the allowlist", () => {
  assert.equal(validateImageInputs(["data:image/svg+xml;base64,AAAA"], { maxCount: 4 }).ok, false);
  assert.equal(validateImageInputs(["data:text/html;base64,AAAA"], { maxCount: 4 }).ok, false);
  assert.equal(
    validateImageInputs(["data:application/pdf;base64,AAAA"], { maxCount: 4 }).ok,
    false,
  );
});

test("rejects a payload that is not base64", () => {
  assert.equal(validateImageInputs([png("AAA$AAA")], { maxCount: 4 }).ok, false);
  assert.equal(validateImageInputs([png("<script>")], { maxCount: 4 }).ok, false);
});

test("rejects a header longer than a real mime type", () => {
  const longHeader = "data:image/png;base64" + ";x=".repeat(40) + ",AAAA";
  assert.equal(validateImageInputs([longHeader], { maxCount: 4 }).ok, false);
});

test("enforces the per-image byte cap", () => {
  assert.equal(
    validateImageInputs([imageOfBytes(MAX_IMAGE_BYTES + 4096)], { maxCount: 4 }).ok,
    false,
  );
});

test("enforces the combined byte cap across images", () => {
  const half = imageOfBytes(Math.floor(MAX_IMAGE_BYTES / 2));
  const r = validateImageInputs([half, half, half, half], {
    maxCount: 4,
    maxTotalBytes: MAX_IMAGE_BYTES,
  });
  assert.equal(r.ok, false);
});

test("blocks loopback, private, link-local and CGNAT hosts", () => {
  for (const host of [
    "localhost",
    "app.localhost",
    "printer.local",
    "127.0.0.1",
    "127.1.2.3",
    "0.0.0.0",
    "10.0.0.7",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "::1",
    "[::1]",
    "::",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
  ]) {
    assert.equal(isBlockedMcpHost(host), true, `expected blocked: ${host}`);
  }
});

test("allows public hosts", () => {
  for (const host of [
    "mcp.example.com",
    "1.1.1.1",
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "2606:4700:4700::1111",
  ]) {
    assert.equal(isBlockedMcpHost(host), false, `expected allowed: ${host}`);
  }
});
