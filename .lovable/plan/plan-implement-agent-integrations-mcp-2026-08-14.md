# Plan: Implement Agent Integrations (MCP)

Implement Model Context Protocol (MCP) support to allow Manipuri AI to interact with external tools and data sources. This will enable advanced capabilities such as interacting with a local filesystem, executing code, and fetching live data from specialized services.

## User Review Required

> [!IMPORTANT]
> To use MCP, you will need to host or provide access to MCP servers (e.g., via a proxy or a public endpoint). This implementation will provide the infrastructure within the app to connect to and use these servers.

- Do you have specific MCP servers you want to connect to first (e.g., Google Search, Brave Search, Filesystem, GitHub)?
- Should the agent automatically decide when to use a tool, or should the user trigger it?

## Proposed Changes

### Backend (Server-Side)

#### MCP Client Implementation
- Create `src/lib/mcp-client.server.ts` to manage connections to MCP servers.
- Implement the protocol to list tools, call tools, and handle responses.
- Add support for environment variables to configure MCP server endpoints.

#### Tool Integration in Chat
- Update `src/routes/api/chat.ts` to include available MCP tools in the model's context.
- Implement tool-call parsing and execution loop within the streaming handler.
- Update the system prompt to instruct the model on how and when to use available tools.

### Frontend

#### Tool Usage UI
- Update `src/components/chat-shared.tsx` to display tool execution status (e.g., "Searching...", "Reading file...").
- Add a UI indicator when a message was generated using specific tools.

### Database & Config
- Add a new table `mcp_servers` to allow admins to manage tool integrations via the dashboard (optional but recommended for flexibility).

## Technical Details

- **Protocol**: MCP (Model Context Protocol) over SSE or stdio (via a proxy for edge compatibility).
- **Model**: Gemini 2.5 Pro (already supports tool calling).
- **Security**: All tool calls will be logged, and sensitive operations (like filesystem access) will require explicit configuration.
