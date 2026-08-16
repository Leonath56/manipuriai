
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
    
    // Strict IP validation to prevent SSRF
    const hostname = url.hostname.toLowerCase();
    const isPrivateIP = (ip: string) => {
      return (
        ip === 'localhost' ||
        ip === '127.0.0.1' ||
        ip === '0.0.0.0' ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') ||
        ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') ||
        ip.startsWith('172.19.') ||
        ip.startsWith('172.20.') ||
        ip.startsWith('172.21.') ||
        ip.startsWith('172.22.') ||
        ip.startsWith('172.23.') ||
        ip.startsWith('172.24.') ||
        ip.startsWith('172.25.') ||
        ip.startsWith('172.26.') ||
        ip.startsWith('172.27.') ||
        ip.startsWith('172.28.') ||
        ip.startsWith('172.29.') ||
        ip.startsWith('172.30.') ||
        ip.startsWith('172.31.') ||
        ip.startsWith('192.168.') ||
        ip.startsWith('169.254.') ||
        ip.endsWith('.local')
      );
    };

    if (isPrivateIP(hostname)) {
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
  // Validate URL to prevent SSRF
  try {
    const url = new URL(serverUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error("Invalid protocol");
    }
    
    const hostname = url.hostname.toLowerCase();
    const isPrivateIP = (ip: string) => {
      return (
        ip === 'localhost' ||
        ip === '127.0.0.1' ||
        ip === '0.0.0.0' ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') ||
        ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') ||
        ip.startsWith('172.19.') ||
        ip.startsWith('172.20.') ||
        ip.startsWith('172.21.') ||
        ip.startsWith('172.22.') ||
        ip.startsWith('172.23.') ||
        ip.startsWith('172.24.') ||
        ip.startsWith('172.25.') ||
        ip.startsWith('172.26.') ||
        ip.startsWith('172.27.') ||
        ip.startsWith('172.28.') ||
        ip.startsWith('172.29.') ||
        ip.startsWith('172.30.') ||
        ip.startsWith('172.31.') ||
        ip.startsWith('192.168.') ||
        ip.startsWith('169.254.') ||
        ip.endsWith('.local')
      );
    };

    if (isPrivateIP(hostname)) {
      console.warn(`Blocking potential SSRF attempt to ${serverUrl}`);
      throw new Error("SSRF blocked");
    }
  } catch (e) {
    console.error(`Invalid MCP server URL: ${serverUrl}`);
    throw e;
  }

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
