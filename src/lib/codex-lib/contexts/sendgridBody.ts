/**
 * SendGrid Body Context
 * Used when writing SendGrid email body
 */

export const sendgridBodyContext = `
## Context: SendGrid Message Help

User wants to write SendGrid email body.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Beginner Guide
When user asks "how to write email?", "help with email":
- Write email content in **Markdown** format
- Use variables like {{name}} for personalization
- Markdown is automatically converted to HTML

---

## NODE CONNECTION

SendGrid is a standard node with **1 input (left), 1 output (right)**.

### Connection Structure
\`\`\`
[Previous Node] → [SendGrid] → [Next Node]
     (left input)           (right output)
\`\`\`

### Common Workflow Patterns

**1. AI Response Email**
\`\`\`
[Start] → [AI: generate content] → [SendGrid: send] → [End]
\`\`\`

**2. Notification After Processing**
\`\`\`
[IMAP: read] → [AI: classify] → [If/Else]
                                    ├─ urgent → [SendGrid: alert]
                                    └─ else → [End]
\`\`\`

**3. Bulk Email (ForEach)**
\`\`\`
[Data Sheet: get recipients] → [While: forEach] → [End]
                                      │
                                     Loop
                                      ↓
                               [AI: personalize]
                                      ↓
                               [SendGrid: send to each]
\`\`\`

**4. Report Email**
\`\`\`
[Data Sheet: read] → [AI: summarize] → [SendGrid: send report]
\`\`\`

### Input Data (from previous nodes)
SendGrid uses template variables:
- \`{{aiResponse}}\` - AI generated content
- \`{{jsonData.xxx}}\` - Structured AI output
- \`{{context.dataSheetResult.rows}}\` - Data Sheet query results
- \`{{context.currentItem}}\` - Current item in ForEach loop

### Output Data (context.sendGridResult)
After SendGrid node executes:
| Field | Type | Description |
|-------|------|-------------|
| \`success\` | boolean | Send status (true/false) |
| \`messageId\` | string | Email message ID (e.g., "sg-xxx") |
| \`toEmail\` | string | Recipient email address |
| \`error\` | string | Error message (only if failed) |

### How to Connect on Canvas
1. Add SendGrid node to canvas
2. Drag from previous node's **right handle** to SendGrid's **left handle**
3. Drag from SendGrid's **right handle** to next node (optional)

---

### Markdown Support (GFM):
- **Headers**: # H1, ## H2, ### H3
- **Bold**: **text**
- **Italic**: *text*
- **Links**: [text](url)
- **Lists**: - item or 1. item
- **Code**: \`code\` or \`\`\`code block\`\`\`
- **Tables**: | col1 | col2 |
- **Blockquotes**: > quote

### Variable Substitution:

**Available Variable Formats:**
| Variable | Description |
|----------|-------------|
| \`{{message}}\` | User's original message |
| \`{{aiResponse}}\` | AI's response text |
| \`{{context.xxx}}\` | Any context variable |
| \`{{jsonData.xxx}}\` | JSON data fields |
| \`{{context.currentItem.xxx}}\` | ForEach loop current item |

**Examples:**
- \`{{context.message}}\` - User message
- \`{{jsonData.customerName}}\` - Customer name from JSON
- \`{{context.imapResult.from}}\` - Email sender from IMAP
- \`{{context.currentItem.email}}\` - Email from ForEach item

### Required Fields:
- **toEmail**: Recipient email (supports variables)
- **fromEmail**: Sender email (must be verified in SendGrid)
- **fromName**: Sender display name (optional)
- **subject**: Email subject (supports variables)
- **bodyTemplate**: Email body in Markdown

### HTML Conversion:
- Uses **remark** + **remarkGfm** + **remarkHtml**
- **Auto-styled**: Font, colors, spacing applied automatically
- **Dual content**: Sends both text/plain (original) and text/html (converted)
- **Fallback**: If conversion fails, wraps in \`<pre>\` tag

### API Configuration:
- API Key stored in **workflow_connections** table (encrypted)
- Provider: 'sendgrid'
- Must configure in Agent Studio before use

### Result (context.sendGridResult):
\`\`\`json
{
  "success": true,
  "messageId": "sg-xxx",
  "toEmail": "recipient@example.com"
}
\`\`\`
On error: \`{ "success": false, "error": "message" }\`

### API Response:
- **Success**: HTTP 202, messageId from X-Message-Id header
- **Error**: Parsed from response JSON (errors array)

### Example Template:
\`\`\`markdown
# Hello {{jsonData.customerName}}!

Thank you for your inquiry about **{{jsonData.product}}**.

## Your Request
{{message}}

## Our Response
{{aiResponse}}

---
Best regards,
Customer Support Team
\`\`\`

### Key Capabilities:
1. **Generate Template**: Create email template based on purpose
2. **Add Variables**: Insert dynamic content with correct syntax
3. **Format Markdown**: Help with Markdown formatting
4. **Preview Variables**: Show which variables are available

### Modifiable Fields:
| Field | Type | Description |
|-------|------|-------------|
| data.toEmail | string | Recipient email (supports variables) |
| data.fromEmail | string | Sender email (must be verified in SendGrid) |
| data.fromName | string | Sender display name (optional) |
| data.subject | string | Email subject (supports variables) |
| data.bodyTemplate | string | Email body in Markdown format |

### Modification Examples:

**Set recipient email from context variable**:
\`\`\`json
{
  "type": "modification",
  "message": "수신자 이메일을 context에서 가져오도록 설정했습니다.",
  "changes": [
    { "nodeId": "SENDGRID_NODE_ID", "path": "data.toEmail", "action": "set", "value": "{{context.imapResult.from}}" }
  ]
}
\`\`\`

**Create email template with AI response**:
\`\`\`json
{
  "type": "modification",
  "message": "AI 응답을 포함한 이메일 템플릿을 생성했습니다.",
  "changes": [
    { "nodeId": "SENDGRID_NODE_ID", "path": "data.subject", "action": "set", "value": "Re: {{context.imapResult.subject}}" },
    { "nodeId": "SENDGRID_NODE_ID", "path": "data.bodyTemplate", "action": "set", "value": "# Hello!\\n\\n{{aiResponse}}\\n\\n---\\nBest regards" }
  ]
}
\`\`\`

**Set up bulk email for ForEach loop**:
\`\`\`json
{
  "type": "modification",
  "message": "ForEach 루프용 대량 이메일을 설정했습니다.",
  "changes": [
    { "nodeId": "SENDGRID_NODE_ID", "path": "data.toEmail", "action": "set", "value": "{{context.currentItem.email}}" },
    { "nodeId": "SENDGRID_NODE_ID", "path": "data.subject", "action": "set", "value": "Hello {{context.currentItem.name}}!" }
  ]
}
\`\`\`

> ⚠️ **IMPORTANT**:
> - Use the **nodeId passed to you** (the SendGrid node ID)
> - Body template uses Markdown format (converted to HTML automatically)
> - Use \\n for newlines in body template
`;
