/**
 * MCP Context
 * Used when configuring MCP (Model Context Protocol) server
 */

export const mcpContext = `
## Context: MCP Server Settings Help

User wants to configure MCP (Model Context Protocol) server.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide
When user asks "what is MCP?", "help":
- MCP connects AI to external services via Function Calling
- Examples: Notion, Slack, GitHub, Google Drive
- AI can read/write data from these services

---

## NODE CONNECTION (Tool Node)

MCP is a **Tool node** that connects to AI node's **tools handle** (bottom).

### Connection Structure
\`\`\`
              [AI Node]
                  │
            tools handle (bottom, orange)
                  │
                  ↓
            [MCP Node]
\`\`\`

### How to Connect on Canvas
1. Add **AI node** to canvas
2. Add **MCP node** to canvas
3. Drag from AI node's **bottom handle** (orange) to MCP node's **top handle**
4. MCP tools automatically appear in AI's "Select tools" dropdown

### Tool Handle Types
| Node | Top Handle | Bottom Handle | Purpose |
|------|------------|---------------|---------|
| AI Node | Input (from previous) | Tools output (orange) | Connect Tool nodes |
| MCP Node | Tools input (orange) | None | Receive from AI |

### Multiple Tools
AI node can connect to multiple Tool nodes:
\`\`\`
              [AI Node]
                  │
            tools handle
           ┌────┼────┐
           ↓    ↓    ↓
      [Source] [WebSearch] [MCP]
\`\`\`

### MCP Connection Setup
Before connecting MCP node:
1. Go to **Settings → MCP Connections**
2. Add OAuth connection (Notion, Telegram, etc.)
3. MCP node will show available tools from connected services

### In While Loop
When AI is a Loop Tool inside While:
- MCP node connects via AI's tools handle
- MCP connection is reused for each iteration
- ⚠️ Be mindful of external service rate limits

---

### Provider Support:

| Provider | MCP Support | Notes |
|----------|-------------|-------|
| **OpenAI** | ✅ | Full support |
| **Gemini** | ✅ | Full support |
| **Claude** | ✅ | Full support |
| **DeepSeek V3** | ✅ | deepseek-chat |
| **Grok** | ✅ | Full support |

### How MCP Works:
1. MCP Connection is configured in Settings
2. AI node loads available tools from MCP server
3. AI can call tools during conversation
4. Tool results are returned to AI for processing

### Configuration:
- **mcpConnectionId**: ID of the MCP connection to use
- MCP connections are managed in Settings → MCP Servers

### Supported Services:

| Provider | Status | DCR | Example Tools |
|----------|--------|-----|---------------|
| **Notion** | ✅ Ready | ✅ OAuth | search, fetch, create-pages, update-page |
| **Telegram** | ✅ Ready | ❌ API Key | send_message, send_order_notification |
| **Custom Server** | ✅ Ready | - | Server-provided tools |
| **Slack** | 🚧 Planned | - | - |
| **GitHub** | 🚧 Planned | - | - |
| **Google** | 🚧 Planned | - | - |

**Custom MCP Server**:
- Connect to any external MCP server
- **Transport Types**:
  - Streamable HTTP: Single endpoint POST (default)
  - SSE: URL ends with \`/sse\` → auto SSE mode
- **SSE Flow**: GET /sse → endpoint event → POST to messages URL
- **Remote Servers**: Semgrep, Linear, Sentry, etc.
- **Note**: Some SSE servers may fail tools/list due to session issues; connection info still shown

**Telegram MCP** (Built-in Server):
- **No HTTP call**: Runs directly in server (TelegramMcpClient class)
- Auth: Bot Token (API Key, encrypted in DB)
- Config: Bot Token + Default Chat ID (stored in serviceConfig)
- Tools:
  - \`send_message\`: Send general message (message, parseMode, chatId)
  - \`send_order_notification\`: Send formatted order (customerName, items[], totalAmount, specialRequest)
- chatId: Uses serviceConfig.chatId as default, can override per call

**Notion Tools** (External MCP Server):
- \`notion-search\`: Search pages and databases
- \`notion-fetch\`: Get page content by ID
- \`notion-create-pages\`: Create new page
- \`notion-update-page\`: Update existing page

### Key Capabilities:
1. **Explain MCP**: What it does and supported services
2. **Check Compatibility**: Verify AI provider supports MCP
3. **Guide Connection**: How to set up MCP server
4. **List Tools**: Available MCP tools and their functions

### OAuth DCR Flow (for Notion, etc.):
1. User selects Provider in MCP Panel
2. PKCE code_verifier/code_challenge generated
3. User authenticates with Provider
4. Callback receives authorization_code
5. Token exchanged and WorkflowConnection created

### Troubleshooting:
- If MCP not working with DeepSeek, check if using R1 model
- MCP requires Function Calling capability
- Ensure MCP connection is active in Settings
- **call_id mismatch**: Use call_id from response.completed, not item_id from stream

### Important Notes:
- ⚠️ **Auto-save before OAuth**: Workflow is saved before OAuth redirect
- ⚠️ **Connection cleanup**: Deleting MCP node removes workflow_connections
- ⚠️ **Fallback**: If MCP server fails, AI continues without tools

---

## Technical Details

### Protocol
- **JSON-RPC 2.0** over HTTP/SSE
- Protocol Version: \`2025-06-18\`
- SSE (Server-Sent Events) response supported

### Token Auto-Refresh
- Expiry check with **5-minute buffer**
- Uses refreshToken for automatic renewal
- Falls back to existing token if refresh fails
- Updates DB with new token on success

### MCP Client Methods
| Method | Description |
|--------|-------------|
| \`initialize()\` | Connect to MCP server, send capabilities |
| \`listTools()\` | Get available tools from server |
| \`callTool(name, args)\` | Execute a tool with arguments |
| \`close()\` | End session (DELETE request) |

### serviceConfig (for Telegram)
\`\`\`json
{
  "chatId": "123456789"  // Default Chat ID
}
\`\`\`
Stored in WorkflowConnection.serviceConfig field.

### Context Result Variables
After MCP execution, results are stored in context:
| Variable | Type | Description |
|----------|------|-------------|
| \`context.mcpTools\` | array | List of available tools \`[{name, description}]\` |
| \`context.mcpResult\` | object | Tool call result \`{content: [{type, text}], isError?}\` |

Example usage in subsequent nodes:
\`\`\`
{{context.mcpResult.content[0].text}}  // Get tool result text
\`\`\`

### SSE Transport Details
When URL ends with \`/sse\`, auto SSE mode is used:
1. **GET** to SSE URL → Open event stream
2. Receive \`event: endpoint\` → Extract message URL
3. **POST** JSON-RPC to message URL (with sessionId)
4. Receive response via SSE stream (\`event: message\`)

Timeout: 30 seconds per request
Error: All pending requests rejected if SSE connection lost

### Remote MCP Server Examples
| Server | URL | Auth |
|--------|-----|------|
| Semgrep | \`https://mcp.semgrep.ai/sse\` | None |
| Linear | \`https://mcp.linear.app/sse\` | OAuth |
| Sentry | \`https://mcp.sentry.dev/sse\` | OAuth |

> More servers: [mcpservers.org/remote-mcp-servers](https://mcpservers.org/remote-mcp-servers)

### Error Handling
- If MCP server connection fails: AI continues without tools (fallback)
- Connection status updated to \`error\` with errorMessage in DB
- Token refresh failure: Falls back to existing token

### MCP Node Direct Execution (Advanced)
MCP node can be used without AI node for direct tool calls:
| Field | Type | Description |
|-------|------|-------------|
| \`data.mcpToolName\` | string | Tool name to call directly |
| \`data.mcpToolArgs\` | object/string | Tool arguments (JSON) |

> Note: Generally recommended to use through AI node for natural language interaction.

### Debug Logs (Server Console):
\`\`\`
[AI Node] MCP tools loaded: 15 tools
[AI Node] Function call started: notion-search fc_xxx
[AI Node] Calling MCP tool: notion-search {...}
[AI Node] MCP tool result: {...}
\`\`\`

### Modifiable Fields (on MCP Node):
When user wants to disconnect MCP connection from MCP Panel, you modify the **MCP node** (the currently focused node).

| Field | Type | Description |
|-------|------|-------------|
| data.mcpConnectionId | string | MCP connection ID (empty string "" to disconnect) |

### Modification Examples:

**Disconnect MCP** (user asks "disconnect", "remove connection", "해제", "연결 끊기"):
Use the **nodeId passed to you** (the MCP node ID that opened this panel).
\`\`\`json
{
  "type": "modification",
  "message": "MCP 연결을 해제했습니다.",
  "changes": [
    { "nodeId": "CURRENT_NODE_ID", "path": "data.mcpConnectionId", "action": "set", "value": "" }
  ]
}
\`\`\`

> ⚠️ **IMPORTANT**:
> - Use the **nodeId that was passed to you** (from MCP Panel), NOT an AI node ID
> - To disconnect, set \`data.mcpConnectionId\` to empty string \`""\`, NOT null
> - Use \`action: "set"\` with proper path, NEVER use empty \`path: ""\`
> - NEVER use \`action: "remove"\` with empty path - this is invalid
`;
