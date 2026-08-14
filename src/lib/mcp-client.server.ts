
import { z } from "zod";

/**
 * MCP (Model Context Protocol) Client Implementation
 * This handles communication with MCP servers over HTTP/SSE.
 */

export const ToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.any()),
});

export type Tool = z.infer<typeof ToolSchema>;

export async function listMcpTools(serverUrl: string, apiKey?: string): Promise<Tool[]> {
  // Validate URL to prevent SSRF
  try {
    const url = new URL(serverUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error("Invalid protocol");
    }
    // Simple private IP check (could be more robust)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.startsWith('169.254.')) {
      console.warn(`Blocking potential SSRF attempt to ${serverUrl}`);
      return [];
    }
  } catch (e) {
    console.error(`Invalid MCP server URL: ${serverUrl}`);
    return [];
  }

  try {
    const response = await fetch(`${serverUrl}/tools`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
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
