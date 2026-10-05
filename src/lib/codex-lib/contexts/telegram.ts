/**
 * Telegram Context
 * Used when configuring Telegram node for messaging
 */

export const telegramContext = `
## Context: Telegram Node Help

User wants to understand and configure the Telegram node for messaging.
This context is EDUCATIONAL - focus on explaining concepts, not modifying workflow.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Response Types

**Use "answer" type for:**
- Questions about concepts (What is parseMode?, How do I get Chat ID?)
- Explanations and help requests

**Use "modification" type for:**
- Commands to change settings (turn on, enable, disable)
- Requests to update node data

---

## NODE CONNECTION

Telegram has **3 different node types** with different connection patterns:

### 1. Telegram Apps Node (Standard)
Standard node: **1 input (left), 1 output (right)**
\`\`\`
[Previous Node] → [Telegram Apps] → [Next Node]
     (left input)              (right output)
\`\`\`

**Use Cases:**
- Send notification after workflow action
- Alert on specific conditions
- Forward processed data to Telegram

### 2. Telegram Start Node (Trigger)
Start node: **No input, 1 output (right)**
\`\`\`
[Telegram Start] → [AI] → [Telegram Apps: reply]
   (trigger)        │
                    └→ webhook receives message
\`\`\`

**Use Cases:**
- Telegram chatbot
- Receive commands from Telegram
- Interactive conversations

### 3. Telegram MCP (Tool Node)
Tool node: connects to AI's **tools handle (bottom)**
\`\`\`
        [AI Node]
            │
      tools handle
            ↓
    [MCP: Telegram]
\`\`\`

**Use Cases:**
- AI decides when to send messages
- Dynamic message content from AI

### Common Workflow Patterns

**1. Alert Notification**
\`\`\`
[IMAP: read] → [AI: classify] → [If/Else]
                                    ├─ urgent → [Telegram: alert]
                                    └─ else → [End]
\`\`\`

**2. Chatbot**
\`\`\`
[Telegram Start] → [AI: respond] → [Telegram Apps: reply]
\`\`\`

**3. ForEach Notification**
\`\`\`
[Data Sheet] → [While: forEach] → [End]
                      │
                     Loop
                      ↓
               [Telegram: notify each]
\`\`\`

### How to Connect on Canvas
- **Apps Node**: Drag left/right handles like standard nodes
- **Start Node**: Only has right output, place at workflow beginning
- **MCP Node**: Connect from AI node's bottom (tools) handle

---

### Modifiable Fields

| Field | Type | Description |
|-------|------|-------------|
| chatId | string | Target chat ID |
| message | string | Message content |
| parseMode | 'HTML' \| 'Markdown' \| 'MarkdownV2' | Formatting mode (or remove for plain text) |
| disableNotification | boolean | true = silent, false = normal notification |

### Modification Examples

User: "enable silent notification"
Response:
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "disableNotification", "value": true }],
  "summary": "Silent notification enabled"
}
\`\`\`

User: "change parseMode to MarkdownV2"
Response:
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "parseMode", "value": "MarkdownV2" }],
  "summary": "Parse mode changed to MarkdownV2"
}
\`\`\`

### Message Template Generation

When user wants to send data from previous nodes, generate appropriate message template.

User: "Send email info from IMAP"
Response:
\`\`\`json
{
  "type": "modification",
  "changes": [{
    "nodeId": "current",
    "field": "message",
    "value": "New Email Received\\n\\nFrom: {{context.currentEmail.from}}\\nSubject: {{context.currentEmail.subject}}\\nDate: {{context.currentEmail.date}}\\n\\n{{context.currentEmail.body}}"
  }],
  "summary": "Email notification template created"
}
\`\`\`

User: "Send AI response"
Response:
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "message", "value": "{{context.aiResponse}}" }],
  "summary": "Message set to AI response"
}
\`\`\`

User: "Create order notification"
Response:
\`\`\`json
{
  "type": "modification",
  "changes": [{
    "nodeId": "current",
    "field": "message",
    "value": "🛒 New Order\\n\\nCustomer: {{jsonData.customerName}}\\nItems: {{jsonData.items}}\\nTotal: {{jsonData.totalAmount}}\\n\\nOrder Time: {{jsonData.orderTime}}"
  }],
  "summary": "Order notification template created"
}
\`\`\`

### Available Context Variables for Message

Help users by suggesting appropriate variables based on their workflow:

| Previous Node | Variables to Use |
|---------------|------------------|
| **IMAP** | \`{{context.currentEmail.from}}\`, \`{{context.currentEmail.subject}}\`, \`{{context.currentEmail.body}}\`, \`{{context.currentEmail.date}}\` |
| **AI** | \`{{context.aiResponse}}\` or \`{{aiResponse}}\` |
| **JSON Schema** | \`{{jsonData.fieldName}}\` (based on schema fields) |
| **Data Sheet** | \`{{context.dataSheetResult}}\` |
| **User Input** | \`{{message}}\` |

### Beginner Guide (PRIORITY)

When user asks "what is Telegram node?", "help", "explain Telegram":

**Telegram Node** allows you to send messages through Telegram Bot API.

---

## THREE WAYS TO USE TELEGRAM

| Type | Category | Role |
|------|----------|------|
| **Telegram** (Apps) | Apps | Send notifications from workflow |
| **Start / Telegram** (Basic) | Basic | Use Bot as AI Chatbot client |
| **Telegram MCP Server** | MCP Tool | AI decides when to send |

### Apps vs Start Comparison

| Scenario | Use Node |
|----------|----------|
| Chat with AI via Telegram | Start / Telegram |
| Web Chat order → Telegram alert to staff | Telegram (Apps) |
| Scheduled task → Send result to Telegram | Telegram (Apps) |
| Question on Telegram → AI answer → Telegram reply | Start / Telegram |

### Apps vs MCP Comparison

| Aspect | Apps Node | MCP Server |
|--------|-----------|------------|
| **Execution** | Always runs in workflow flow | AI calls only when needed |
| **Decision maker** | Workflow designer | AI (understands context) |
| **Use case** | All orders → alert | Only confirmed orders → alert |
| **Flexibility** | Fixed flow | Natural conversation flow |

---

## BOT SETUP

### Creating a Telegram Bot
1. Open Telegram and search for @BotFather
2. Send /newbot command
3. Follow instructions to name your bot
4. Receive Bot Token (keep it secret!)

### Getting Chat ID

| Method | For |
|--------|-----|
| @userinfobot | Personal Chat ID |
| getUpdates API | Group/Personal after sending message |
| @channelusername | Public channels only |

### Chat ID Formats

| Type | Format | Example |
|------|--------|---------|
| **Personal** | Positive number | \`123456789\` |
| **Group** | Negative number | \`-123456789\` |
| **Supergroup/Channel** | Negative long | \`-1001234567890\` |

### Chat ID Input Methods

| Format | Personal | Private Group | Public Group/Channel |
|--------|----------|---------------|---------------------|
| Numeric ID | ✅ | ✅ | ✅ |
| @username | ❌ | ❌ | ✅ |

> **Important**: To send to individuals, you MUST use numeric Chat ID.
> @username cannot send to personal chats (Telegram privacy policy).

---

## TELEGRAM APPS NODE

### Node Data Structure

| Field | Type | Description |
|-------|------|-------------|
| chatId | string | Target chat ID (template variables supported) |
| message | string | Message content (template variables supported) |
| parseMode | 'HTML' \\| 'Markdown' \\| 'MarkdownV2' | Formatting mode |
| disableNotification | boolean | Silent notification |

### Result Structure

\`\`\`typescript
context.telegramResult = {
  success: boolean,
  messageId?: number,
  chatId?: string,
  error?: string
}
\`\`\`

### Template Variables

Template variables use \`{{...}}\` syntax to insert dynamic data from previous nodes in the workflow.

**How it works:**
1. Previous nodes (IMAP, AI, Data Sheet, etc.) save results to \`context\`
2. Telegram node reads these values using \`{{context.xxx}}\`
3. At runtime, variables are replaced with actual values

| Variable | Description | Example Value |
|----------|-------------|---------------|
| \`{{context.xxx}}\` | Data from previous nodes | Any saved result |
| \`{{message}}\` | User's input message | "Hello" |
| \`{{aiResponse}}\` | AI node response | "How can I help?" |
| \`{{jsonData.xxx}}\` | JSON Schema extracted data | Order details |

### Real-World Example: IMAP → Telegram

When IMAP node reads an email, it saves to \`context.currentEmail\`:

\`\`\`
📧 Invoice Email Received

From: {{context.currentEmail.from}}
Subject: {{context.currentEmail.subject}}
Date: {{context.currentEmail.date}}

{{context.currentEmail.body}}
\`\`\`

**Result at runtime:**
\`\`\`
📧 Invoice Email Received

From: billing@company.com
Subject: Invoice #12345
Date: 2026-02-03

Your invoice is attached...
\`\`\`

### Common Context Variables by Node

| Previous Node | Available Variables |
|---------------|---------------------|
| **IMAP** | \`currentEmail.from\`, \`currentEmail.subject\`, \`currentEmail.body\`, \`currentEmail.date\` |
| **AI** | \`aiResponse\`, \`jsonData\` (if JSON Schema used) |
| **Data Sheet** | \`dataSheetResult\` (query results) |
| **JSON Schema** | \`jsonData.fieldName\` (extracted fields) |

---

## START / TELEGRAM NODE

### Overview
Use Telegram Bot as AI Chatbot client. Like Web Chat Widget, but for Telegram.

### Webhook Auto-Setup
- Bot Token saved → Webhook automatically configured
- Bot username fetched via getMe API
- Connection status shown (Connected/Disconnected)
- Bot link displayed (t.me/username)

### Context Variables (Available in Workflow)

| Variable | Type | Description |
|----------|------|-------------|
| \`telegramChatId\` | number | Telegram Chat ID |
| \`telegramUserId\` | number | Telegram User ID |
| \`telegramUsername\` | string | Username or first name |
| \`message\` | string | User's message text |

### Conversation History
- Automatically managed
- Keeps last 40 messages (20 turns)
- Persisted in WorkflowTempStorage
- Session key: \`telegram:{chatId}\`

### Typing Indicator
- "typing..." shown while AI generates response
- Automatically sent before workflow execution
- Lasts ~5 seconds

---

## TELEGRAM MCP SERVER

AI decides when to send Telegram messages based on conversation context.

### Available Tools

| Tool | Description |
|------|-------------|
| send_message | Send general message |
| send_order_notification | Send formatted order notification |

### send_message Schema
\`\`\`json
{
  "name": "send_message",
  "parameters": {
    "message": "string (required)",
    "parseMode": "HTML | Markdown | MarkdownV2 (optional)",
    "chatId": "string (optional, uses default)"
  }
}
\`\`\`

### send_order_notification Schema
\`\`\`json
{
  "name": "send_order_notification",
  "parameters": {
    "customerName": "string (required)",
    "items": [{ "name": "string", "quantity": "number", "price": "number" }],
    "totalAmount": "number (required)",
    "specialRequest": "string (optional)",
    "chatId": "string (optional)"
  }
}
\`\`\`

### Use Case Example
\`\`\`
User: "How much is pizza?" → AI: "$15" (NO Telegram)
User: "Is it good?" → AI: "Yes, fresh ingredients..." (NO Telegram)
User: "Order 2 pizzas please" → AI: "Your name?" (NO Telegram)
User: "John Smith" → AI: "Order confirmed!" → send_order_notification() ✅
\`\`\`

---

## PARSE MODE

### Default Value: None (Plain Text)
- If parseMode not specified, message sent as plain text
- **Important**: Changed from HTML to None (2026-01-20)
- Reason: Email addresses like \`<email@domain>\` caused HTML parsing errors

### Available Modes

| Mode | Description | Recommended |
|------|-------------|-------------|
| None | Plain text, no formatting | Default (safest) |
| HTML | \`<b>\`, \`<i>\`, \`<a>\` tags | When using HTML formatting |
| Markdown | Basic Markdown (deprecated) | Not recommended |
| MarkdownV2 | Extended Markdown | For AI responses |

### MarkdownV2 Supported

| Format | Syntax | Result |
|--------|--------|--------|
| Bold | \`*text*\` | **text** |
| Italic | \`_text_\` | _text_ |
| Underline | \`__text__\` | underline |
| Strikethrough | \`~text~\` | ~~text~~ |
| Code | \`\\\`text\\\`\` | \`text\` |
| Code block | \`\\\`\\\`\\\`text\\\`\\\`\\\`\` | code block |
| Link | \`[text](url)\` | link |

### MarkdownV2 NOT Supported
- \`### Heading\` - Shows as text
- \`- list item\` - Shows as text

### MarkdownV2 Auto-Conversion
When parseMode is MarkdownV2, Webhook API automatically converts:
- \`**bold**\` → \`*bold*\`
- \`*italic*\` → \`_italic_\`
- Escapes special characters (_, *, [, ], etc.)
- Protects code blocks, inline code, links

---

## COMMON USE CASES

### 1. Error Alert
\`\`\`
Monitor → Detect Error → Telegram Alert Admin
\`\`\`

### 2. Order Notification (Apps Node)
\`\`\`
Web Chat → Process Order → Telegram Notify Staff
\`\`\`

### 3. AI Chatbot (Start Node)
\`\`\`
Telegram User → Bot receives message → AI → Reply to Telegram
\`\`\`

### 4. Context-Aware Alert (MCP)
\`\`\`
Chat with AI → AI detects order confirmation → Auto-send to staff
\`\`\`

---

## TROUBLESHOOTING

### "Chat not found"
- Verify Chat ID is correct (numeric for individuals)
- Bot must be added to group/channel first
- For channels, bot must be admin

### "Unauthorized"
- Check Bot Token is correct
- Token may have been revoked by @BotFather

### "Message too long"
- Telegram limit: 4096 characters
- Split long messages into multiple sends

### "can't parse entities" (e.g., Unsupported start tag)
- Text contains \`<>\` interpreted as HTML tags
- Solution: Don't use parseMode, or use None/plain text
- Common with email addresses: \`<email@domain.com>\`

### "Bad Request: chat not found" for @username
- @username only works for public groups/channels
- For individuals, must use numeric Chat ID

### Bot not responding (Start Node)
- Check Webhook status (Connected/Disconnected)
- Verify Bot Token is saved
- Check workflow has Start/Telegram node
- Check PM2/server logs for errors

### AI response empty
- Workflow must run in sync mode (not streaming)
- isTelegramWebhook flag automatically set
- Check AI node configuration
`;
