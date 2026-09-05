
import { z } from "zod";

/**
 * MCP (Model Context Protocol) Client Implementation
 * This handles communication with MCP servers over HTTP/SSE.
 */

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.any()),
});

export type Tool = z.infer<typeof ToolSchema>;

/**
 * Neither call had a timeout, so a single unresponsive MCP server could hang a
 * chat request forever: discovery blocks the model call, and a tool call blocks
 * mid-stream with the user watching a half-written reply.
 *
 * Discovery is short because it is on the critical path and its result is
 * optional. Execution is longer because the user explicitly asked for the tool
 * and its result is the answer.
 */
const DISCOVERY_TIMEOUT_MS = 2500;
const TOOL_CALL_TIMEOUT_MS = 15000;

/**
 * Reject MCP server URLs that point back inside our own network.
 *
 * This check existed twice, copied verbatim into both call sites, so a fix to one
 * would have silently missed the other. One definition now, with the gaps both
 * copies shared closed: the whole 127/8 loopback range rather than only
 * 127.0.0.1, IPv6 loopback and link-local (which `new URL()` hands back wrapped
 * in brackets), IPv4-mapped IPv6, and carrier-grade NAT.
 *
 * `fetch` still resolves DNS after this check, so a public hostname that resolves
 * to a private address gets through. Blocking that needs resolution before
 * connect, which the Workers runtime doesn't expose. MCP servers are
 * admin-registered, so what remains is an admin pointing at their own network.
 */
export function isBlockedMcpHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;

  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (host.startsWith("::ffff:")) return isBlockedMcpHost(host.slice("::ffff:".length));
    // Unique-local fc00::/7 and link-local fe80::/10.
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    return false;
  }

  const octets = host.split(".").map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

/** Throws when `serverUrl` isn't a plain http(s) URL to a public host. */
function assertSafeMcpUrl(serverUrl: string): void {
  const url = new URL(serverUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid protocol");
  }
  if (isBlockedMcpHost(url.hostname)) {
    throw new Error("SSRF blocked");
  }
}

export async function listMcpTools(serverUrl: string, apiKey?: string): Promise<Tool[]> {
  // Discovery is optional, so a bad URL degrades to "no tools" rather than
  // failing the chat request.
  try {
    assertSafeMcpUrl(serverUrl);
  } catch {
    console.error(`Refusing MCP server URL: ${serverUrl}`);
    return [];
  }

  try {
    const response = await fetch(`${serverUrl}/tools`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      // Tool discovery gates the model request, so an unresponsive MCP server
      // used to stall every chat message for as long as the socket stayed open.
      // Discovery is optional — time out fast and answer without tools.
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`Failed to list tools from MCP server at ${serverUrl}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return z.array(ToolSchema).parse(data.tools || []);
  } catch (err) {
    console.error(`Error connecting to MCP server ${serverUrl}:`, err);
    return [];
  }
}

export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>,
  apiKey?: string
): Promise<any> {
  // The caller asked for this tool by name, so a rejected URL is a real error.
  assertSafeMcpUrl(serverUrl);

  try {
    const response = await fetch(`${serverUrl}/tools/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        name: toolName,
        arguments: args,
      }),
      // Bounded so a hung tool cannot freeze a reply that is already streaming.
      signal: AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MCP tool call failed (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`Error calling MCP tool ${toolName} at ${serverUrl}:`, err);
    throw err;
  }
}

export async function getActiveMcpServers() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("mcp_servers")
    .select("*")
    .eq("is_active", true);
    
  if (error) {
    console.error("Error fetching MCP servers:", error);
    return [];
  }
  
  return data || [];
}
