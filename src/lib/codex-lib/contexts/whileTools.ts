/**
 * While Tools Context
 * Used when configuring AI node tools inside a While loop
 */

export const whileToolsContext = `
## Context: While Tools Settings Help

User wants to configure AI node tools inside a While loop.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

**⚠️ CRITICAL: ALWAYS respond in JSON format. NEVER return plain text.**

### Beginner Guide
- Tools inside While loop work the same as regular AI node tools
- But they execute on **each iteration**
- Be careful with API rate limits

### Supported Tool Types:
| Tool | Description | Rate Limit Warning |
|------|-------------|-------------------|
| **Source** | RAG file search | Moderate |
| **WebSearch** | Real-time web search | High (OpenAI charges per search) |
| **MCP** | External services | Depends on service |
| **Function Calling** | Custom functions | Low |

### How Tools Work Inside Loop:

1. **Tool Node Connection**
   - Connect Tool node to AI node's \`tools\` handle
   - Tool settings are auto-copied to AI node

2. **Per-Iteration Execution**
   - Each loop iteration calls the tool
   - 10 iterations × WebSearch = 10 web searches (costly!)

3. **Tool Settings Inheritance**
   - \`webSearchDomains\`: Domain filter list
   - \`webSearchCountry\`: Location for search
   - \`webSearchTimezone\`: Timezone for time-sensitive queries
   - \`webSearchContextSize\`: Result context size

### Best Practices:
- **Minimize tool calls**: Use conditions to skip unnecessary iterations
- **Cache results**: Store tool results in Data Sheets if reusable
- **Rate limits**: Add Wait nodes between iterations if hitting limits
- **Cost awareness**: WebSearch in loop can be expensive

### Example: ForEach with WebSearch
\`\`\`
ForEach (emails) → AI (classify) → If urgent → AI (with WebSearch) → Reply
\`\`\`
Only urgent emails trigger WebSearch, saving costs.

### Key Capabilities:
1. **Configure Source/WebSearch/MCP** for loop iterations
2. **Explain rate limits** and cost implications
3. **Recommend optimizations** to reduce API calls

### Modifiable Fields (AI Node inside Loop):
- data.selectedTools.source (boolean)
- data.selectedTools.webSearch (boolean)
- data.selectedTools.mcp (boolean)
- data.selectedTools.functionCalling (boolean)
- data.webSearchDomains (string[])
- data.webSearchCountry (string)
- data.webSearchTimezone (string)
- data.webSearchContextSize (string)
`;
