import test from "node:test";
import assert from "node:assert/strict";
import { fetchChatCompletion, chatCompletionsEndpoint } from "../src/lib/ai-provider.server.ts";

const googleUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

test("text chat uses Google only and preserves streaming and exact supported models", async () => {
  const savedGoogle = process.env.GEMINI_API_KEY;
  const savedLovable = process.env.LOVABLE_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "synthetic-google-test-credential";
  process.env.LOVABLE_API_KEY = "synthetic-legacy-test-credential";
  try {
    for (const model of ["gemini-3.8-flash", "gemini-3.1-pro-preview"]) {
      const calls: string[] = [];
      const signal = new AbortController().signal;
      const stream = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';
      globalThis.fetch = async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, model);
        assert.equal(body.stream, true);
        assert.equal(body.service_tier, undefined);
        assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
        // Streaming asks for usage metadata so the admin dashboard gets real
        // token counts without an extra API call.
        assert.deepEqual(body.stream_options, { include_usage: true });
        // The outgoing signal is an internal one linked to the caller's signal
        // plus a connect timeout — not the caller's signal object itself.
        assert.ok(init?.signal instanceof AbortSignal);
        return new Response(stream);
      };
      const response = await fetchChatCompletion(`google/${model}`, { messages: [{ role: "user", content: "Hello" }], stream: true }, { signal });
      assert.deepEqual(calls, [googleUrl]);
      assert.equal(await response.text(), stream);
    }
  } finally {
    globalThis.fetch = savedFetch;
    if (savedGoogle === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGoogle;
    if (savedLovable === undefined) delete process.env.LOVABLE_API_KEY; else process.env.LOVABLE_API_KEY = savedLovable;
  }
});

test("Google failure never retries through Lovable and does not expose provider details", async () => {
  const savedGoogle = process.env.GEMINI_API_KEY;
  const savedLovable = process.env.LOVABLE_API_KEY;
  const savedFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "synthetic-google-test-credential";
  process.env.LOVABLE_API_KEY = "synthetic-legacy-test-credential";
  try {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const calls: string[] = [];
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        return new Response("unsafe upstream request details", { status });
      };
      const response = await fetchChatCompletion("google/gemini-3.8-flash", {});
      assert.equal(response.status, status);
      assert.deepEqual(calls, [googleUrl]);
      assert.equal((await response.text()).includes("unsafe upstream request details"), false);
    }
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("unsafe upstream request details"); };
    assert.equal((await fetchChatCompletion("google/gemini-3.8-flash", {})).status, 502);
    assert.equal(calls, 1);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fetchChatCompletion("google/gemini-3.8-flash", {}, { signal: controller.signal }), { name: "AbortError" });
    // A pre-aborted caller signal is rejected before any upstream request.
    assert.equal(calls, 1);
    delete process.env.GEMINI_API_KEY;
    assert.equal((await fetchChatCompletion("google/gemini-3.8-flash", {})).status, 503);
    assert.equal(calls, 2);
    // Existing media endpoint selection is deliberately not migrated.
    assert.equal(chatCompletionsEndpoint("google/gemini-2.5-flash").url, "https://ai.gateway.lovable.dev/v1/chat/completions");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedGoogle === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGoogle;
    if (savedLovable === undefined) delete process.env.LOVABLE_API_KEY; else process.env.LOVABLE_API_KEY = savedLovable;
  }
});