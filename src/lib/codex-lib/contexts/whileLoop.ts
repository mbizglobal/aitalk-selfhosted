/**
 * While Loop Context
 * Used when configuring While node's loop condition
 */

export const whileLoopContext = `
## Context: While Loop Settings Help

User wants to configure While node's loop condition.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

**⚠️ CRITICAL: ALWAYS respond in JSON format. NEVER return plain text.**

For explanations/questions, use:
\`\`\`json
{ "type": "answer", "message": "Your explanation here..." }
\`\`\`

For modifications, use:
\`\`\`json
{ "type": "modification", "message": "...", "changes": [...] }
\`\`\`

### Beginner Guide
When user asks "what is while loop?", "help":
- While loop repeats actions until a condition is met
- Two modes: **While** (condition-based) and **ForEach** (array iteration)
- Use for: pagination, batch processing, email processing

---

## NODE CONNECTION (Core Concept)

While node has **1 input, 2 outputs** (Exit and Loop).

### Handles

| Handle | Position | ID | Color | Purpose |
|--------|----------|-----|-------|---------|
| Input | Left | (default) | Gray | Connect from previous node |
| Exit | Right | \`exit\` | Green | Connect to next node after loop ends |
| Loop | Bottom | \`loop\` | Orange | Connect to Loop Tools (internal nodes) |

### Connection Flow (Edge Structure)

**⚠️ CRITICAL: ALL Loop Tools connect DIRECTLY from While's "loop" handle!**
**They are NEVER chained to each other!**

\`\`\`
[Previous Node] → [While] ──Exit──→ [Next Node]
                    │
                    ├──loop──→ [AI]       (loopOrder: 0)
                    ├──loop──→ [SMTP]     (loopOrder: 1)
                    └──loop──→ [IMAP]     (loopOrder: 2)

Execution: AI → SMTP → IMAP (by loopOrder, NOT by edges!)
\`\`\`

**Edge JSON:**
\`\`\`json
{ "source": "while", "sourceHandle": "loop", "target": "ai" }
{ "source": "while", "sourceHandle": "loop", "target": "smtp" }
{ "source": "while", "sourceHandle": "loop", "target": "imap" }
{ "source": "while", "sourceHandle": "exit", "target": "end" }
\`\`\`

**❌ WRONG (Never chain loop tools!):**
\`\`\`json
{ "source": "ai", "target": "smtp" }  // NO!
{ "source": "smtp", "target": "imap" } // NO!
\`\`\`

### Loop Tools Connection
- Click **[+]** button below While node to add Loop Tools
- Loop Tools execute in order by \`loopOrder\` (0, 1, 2...)
- **ALL Loop Tools connect from While's "loop" handle** (multiple edges!)
- Maximum 10 Loop Tools per While node

### Example: Email Processing
\`\`\`
[IMAP: fetch] → [While: forEach emails]
                        │
                        ├──loop──→ [AI: classify]    (loopOrder: 0)
                        ├──loop──→ [If/Else: route]  (loopOrder: 1)
                        ├──loop──→ [SMTP: reply]     (loopOrder: 2)
                        │
                        └──exit──→ [End Node]
\`\`\`

**Edges for this example:**
\`\`\`json
{ "source": "imap", "target": "while" }
{ "source": "while", "sourceHandle": "loop", "target": "ai" }
{ "source": "while", "sourceHandle": "loop", "target": "ifelse" }
{ "source": "while", "sourceHandle": "loop", "target": "smtp" }
{ "source": "while", "sourceHandle": "exit", "target": "end" }
\`\`\`

### How to Connect on Canvas
1. Connect previous node to While node's **left input**
2. Click **[+]** button below While to add Loop Tools
3. **ALL Loop Tools connect from While's "loop" handle** (not chained!)
4. Connect While's **right exit** (green) to next node after loop

---

### Loop Modes:

**1. While Mode (condition-based)**
- Repeats until condition becomes false
- Settings:
  - \`conditionMode\`: simple / builder / advanced (Code)
  - \`conditionField\`: Field to compare (e.g., "jsonData.hasMore")
  - \`conditionOperator\`: ==, !=, >, <, >=, <=
  - \`conditionValueType\`: string / number / boolean
  - \`conditionValue\`: Value to compare against
  - \`customExpression\`: JavaScript expression (Code mode only)
  - \`maxIterations\`: Maximum iterations (default: **10**, max: 100)
- AI node response triggers condition re-evaluation (exits if false)

**Value Types:**
- **String**: Text comparison (e.g., status == "pending")
- **Number**: Numeric comparison (e.g., score < 85)
- **Boolean**: true/false comparison (e.g., needsRetry == true)

**Builder Mode (Multiple Conditions):**
- \`conditionLogic\`: "all" (AND) or "any" (OR)
- \`conditions\`: Array of condition objects
- Each condition: { field, operator, value, type }
- Example: (score > 80 AND status == "pending") OR (priority == "high")

**2. ForEach Mode (array iteration)**
- Iterates over each item in an array
- Settings:
  - \`forEachSource\`: Array path (e.g., "imapResult.emails")
  - \`forEachItemVar\`: Variable name for current item (e.g., "currentEmail")
  - \`maxIterations\`: Maximum items to process (default: **100**)
- 1-second delay between iterations (for IMAP UID sync stability)
- NO condition re-evaluation after AI node (always processes all items)
- Available context variables in loop:
  - \`context.[forEachItemVar]\`: Current array item
  - \`context.currentIndex\`: Current iteration index (0-based)
  - \`context.totalCount\`: Total number of items
  - \`context.forEachContext\`: Full ForEach state object

**Supported Source Arrays (ForEach):**
- IMAP: \`imapResult.emails\`
- Data Sheets: \`dataSheetsResult.rows\` or \`queryResult.rows\`
- AI JSON: \`jsonData.items\`

**ForEach Variable Reference in AI Prompt:**
\`\`\`
Subject: {{context.currentEmail.subject}}
From: {{context.currentEmail.from}}
Body: {{context.currentEmail.body}}
Index: {{context.currentIndex}} of {{context.totalCount}}
\`\`\`

### Loop Internal Nodes (Loop Tools):
- Nodes inside the loop are executed in order by \`loopOrder\`
- **Supported nodes**: AI, MCP, Wait, Data Sheets, If/Else, Continue, IMAP, SMTP, Telegram, SendGrid
- **Maximum**: 10 Loop Tools per While node
- Drag & drop to reorder in UI
- **Continue node**: Skips remaining nodes and starts next iteration

**Adding Loop Tools:**
1. Click "Edit" button in Loop Tools section
2. Select node types to add (AI, MCP, Wait, Data Sheets, If/Else, Continue)
3. Drag to reorder execution sequence
4. Each tool gets a \`loopOrder\` number (1, 2, 3...)

**AI Node Tools Inside Loop:**
- AI node inside loop can have Tool nodes connected (Source, WebSearch, MCP)
- Tools are auto-detected via \`tools\` handle connection
- Tool settings (webSearchDomains, etc.) are copied from Tool node to AI node
- Be mindful of API rate limits when using tools in loops

### If/Else Inside Loop (jumpTo):
- \`includeBranchesInLoop\`: Execute branch nodes even if outside loop handle (default: true)
- Can jump to other Loop Tools by their \`loopOrder\`
- Can also execute **external nodes** (outside Loop Tools) when includeBranchesInLoop=true
- External node chain executes until End node or connection ends

### Wait Node Inside Loop:
- Loop pauses at Wait node
- Resumes from the same position when conversation continues
- Saved context: \`whileLoopContext\` = { whileNodeId, currentIteration, loopToolIndex }
- On resume: continues from exact position (iteration + tool index)

### Loop Result (context.whileResult):
After loop completes:
\`\`\`json
{
  "type": "while" | "forEach",
  "totalIterations": 5,
  "maxIterations": 10,
  "terminatedBy": "condition" | "max-iterations" | "forEach-complete" | "wait" | "archive-failed",
  "iterations": [...],
  "sourceField": "imapResult.emails",  // ForEach only
  "itemVariable": "currentEmail"       // ForEach only
}
\`\`\`

**terminatedBy values:**
- \`condition\`: While condition became false
- \`max-iterations\`: Reached maxIterations limit
- \`forEach-complete\`: Processed all array items
- \`wait\`: Paused at Wait node (waiting for user input)
- \`archive-failed\`: IMAP archive failed (auto-retry after 1 minute)

**Archive Failed Handling (IMAP):**
- When IMAP move/archive fails, loop stops immediately
- Returns \`needsRetry: true\` and \`retryAfterMs: 60000\` (1 minute)
- Scheduler will auto-retry the workflow after delay
- Common cause: folder not found, connection timeout

### Key Capabilities:
1. **Set Condition**: Define when to stop looping (While mode)
2. **Set Array Source**: Specify array to iterate (ForEach mode)
3. **Set Max Iterations**: Prevent infinite loops
4. **Explain Current Setup**: Describe current loop configuration

### Common Patterns (Quick Presets in UI):

| Pattern | Condition | Use Case |
|---------|-----------|----------|
| \`needsRetry == true\` | Boolean | Retry logic until success |
| \`validationScore < 85\` | Number | Quality check, repeat if score too low |
| \`isApproved == false\` | Boolean | Approval waiting loop |

These patterns can be clicked in the UI to auto-fill the condition fields.

### Common Use Cases:
- **Email Processing**: ForEach over imapResult.emails
- **Pagination**: While hasNextPage is true
- **Batch Processing**: ForEach over jsonData.items
- **Retry Logic**: While not successful and attempts < maxRetries

### While vs ForEach Key Differences:
| Aspect | While | ForEach |
|--------|-------|---------|
| Condition check | Every iteration start | None |
| AI node re-evaluation | Yes (exits if false) | No (always continues) |
| Default maxIterations | 10 | 100 |
| Iteration delay | None | 1 second |

### Variable Access:
- Use \`jsonData.xxx\` prefix for AI JSON output
- \`context.\` prefix is auto-removed (optional)
- Example: \`jsonData.hasMore == true\` or \`context.jsonData.hasMore == true\`

### Modifiable Fields:
**Common:**
- data.loopMode ("while" | "forEach")
- data.maxIterations
- data.includeBranchesInLoop (boolean)

**While mode only:**
- data.conditionMode ("simple" | "builder" | "advanced")
- data.conditionField
- data.conditionOperator
- data.conditionValue
- data.conditionValueType ("string" | "number" | "boolean")
- data.customExpression (Code mode)
- data.conditionLogic ("all" | "any") - Builder mode
- data.conditions (Array) - Builder mode

**ForEach mode only:**
- data.forEachSource
- data.forEachItemVar

---

### ⚠️ CRITICAL: Minimal Changes Rule

**ONLY modify fields that the user explicitly requested.**

**Mode Switching Examples:**

1. **"Change to While mode"** → Change ONLY \`loopMode\`:
\`\`\`json
{
  "type": "modification",
  "message": "Changed to While mode.",
  "changes": [
    { "nodeId": "while-1", "path": "data.loopMode", "action": "set", "value": "while" }
  ]
}
\`\`\`
❌ Do NOT touch forEachSource, forEachItemVar (they are ForEach-only fields)

2. **"Change to ForEach mode"** → Change ONLY \`loopMode\`:
\`\`\`json
{
  "type": "modification",
  "message": "Changed to ForEach mode.",
  "changes": [
    { "nodeId": "while-1", "path": "data.loopMode", "action": "set", "value": "forEach" }
  ]
}
\`\`\`
❌ Do NOT touch conditionField, conditionValue (they are While-only fields)

3. **"Set condition to score < 85"** → Change condition fields only:
\`\`\`json
{
  "type": "modification",
  "message": "Set condition: score < 85",
  "changes": [
    { "nodeId": "while-1", "path": "data.conditionField", "action": "set", "value": "jsonData.score" },
    { "nodeId": "while-1", "path": "data.conditionOperator", "action": "set", "value": "<" },
    { "nodeId": "while-1", "path": "data.conditionValue", "action": "set", "value": "85" },
    { "nodeId": "while-1", "path": "data.conditionValueType", "action": "set", "value": "number" }
  ]
}
\`\`\`

**Rules:**
- Never modify fields that weren't requested
- Never clear/reset fields when switching modes
- If user only asks to switch mode, only change \`loopMode\`
- \`nodeId\` is REQUIRED in every change object
`;
