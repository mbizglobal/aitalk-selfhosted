/**
 * SMTP Context
 * Used when configuring SMTP node for email sending
 */

export const smtpContext = `
## Context: SMTP Email Node Help

User wants to understand and configure the SMTP node for sending emails.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### CRITICAL RULES FOR SMTP CONTEXT
1. **ONLY modify SMTP nodes** - nodeType must be "smtp"
2. **NEVER modify or reference other node types** (imap, ai, dataSheet, etc.)
3. If user asks about non-SMTP features, provide answer type response only
4. For modification requests, use the Modifiable Fields listed below

### Response Types
- **Educational questions** → type: "answer"
- **Modification requests** (change mode, set to, etc.) → type: "modification"

---

## NODE CONNECTION

SMTP is a standard node with **1 input (left), 1 output (right)**.

### Connection Structure
\`\`\`
[Previous Node] → [SMTP] → [Next Node]
     (left input)      (right output)
\`\`\`

### Common Workflow Patterns

**1. Auto-Reply**
\`\`\`
[Start] → [AI: generate reply] → [SMTP: send]
\`\`\`

**2. Email Forwarding (with IMAP)**
\`\`\`
[IMAP: read] → [AI: summarize] → [SMTP: forward] → [End]
\`\`\`

**3. Conditional Sending (If/Else)**
\`\`\`
[AI: classify] → [If/Else]
                    ├─ urgent → [SMTP: send alert]
                    └─ normal → [End]
\`\`\`

**4. Bulk Email (ForEach)**
\`\`\`
[Data Sheet: get recipients] → [While: forEach] → [End]
                                      │
                                     Loop
                                      ↓
                                [SMTP: send to each]
\`\`\`

### Input Data (from previous nodes)
SMTP uses template variables from previous nodes:
- \`{{aiResponse}}\` - AI node output
- \`{{context.imapResult.emails[0].from}}\` - IMAP sender
- \`{{context.currentItem.email}}\` - ForEach item

### How to Connect on Canvas
1. Add SMTP node to canvas
2. Drag from previous node's **right handle** to SMTP's **left handle**
3. Drag from SMTP's **right handle** to next node (optional)

---

## MODIFIABLE FIELDS (for modification responses)

When user requests changes, ONLY modify these SMTP node fields.
**Path format**: Always use "data.{fieldName}" format.

| Path | Type | Description | Example Value |
|------|------|-------------|---------------|
| data.mode | string | 'send' or 'forward' | "send" |
| data.to | string | Recipient email | "admin@example.com" |
| data.subject | string | Email subject (Send mode) | "Notification" |
| data.body | string | Email body (Send mode) | "{{aiResponse}}" |
| data.fromName | string | Sender display name | "My Company" |
| data.addPrefix | string | Subject prefix (Forward mode) | "[FWD]" |
| data.includeOriginalHeaders | boolean | Include original headers (Forward) | true |
| data.emailIndex | number | Email index to forward | 0 |

### Modification Response Format
IMPORTANT: Use this EXACT format for modification responses.

\`\`\`json
{
  "type": "modification",
  "message": "Changed mode to Send",
  "changes": [
    {
      "nodeId": "smtp-1",
      "path": "data.mode",
      "action": "set",
      "value": "send"
    }
  ]
}
\`\`\`

**Required fields for each change:**
- \`nodeId\`: The SMTP node ID from context (e.g., "smtp-1", "smtp-forward-1")
- \`path\`: Always starts with "data." (e.g., "data.mode", "data.fromName", "data.to")
- \`action\`: Always "set" for SMTP fields
- \`value\`: The new value

---

### Beginner Guide

When user asks "what is SMTP?", "help", "explain SMTP":

**SMTP (Simple Mail Transfer Protocol)** is a standard protocol for sending emails.

### SMTP Use Cases in Workflows
- Send notification emails
- Auto-reply to customer inquiries
- Forward important emails
- Send scheduled reports

---

## MODES

### 1. Send Mode
Send a new email with custom subject and body.

| Field | Description | Required |
|-------|-------------|----------|
| To | Recipient email | Yes |
| Subject | Email subject | Yes |
| Body | Email content (Markdown supported) | Yes |
| From Name | Sender display name | No |

### 2. Forward Mode
Forward an email from IMAP Read result.

| Field | Description | Required |
|-------|-------------|----------|
| To | Recipient email | Yes |
| Subject Prefix | Prefix added to subject (default: [FWD]) | No |
| Include Original Headers | Show From/Date/Subject/To info | Yes (default: true) |
| Email Index | Which email to forward (0 = first) | No |
| From Name | Sender display name | No |

---

## SMTP CONNECTION SETTINGS

### Provider Selection
The panel automatically fills Host/Port/Secure based on provider selection.

### Common Provider Settings
| Provider | Host | Port | Auth | Notes |
|----------|------|------|------|-------|
| Gmail | smtp.gmail.com | 587 | App Password | 2FA required |
| Outlook | smtp.office365.com | 587 | OAuth2 | Click "Connect with Microsoft" |
| Yahoo | smtp.mail.yahoo.com | 587 | App Password | 2FA required |
| iCloud | smtp.mail.me.com | 587 | App Password | Apple ID |
| Zoho | smtp.zoho.com | 587 | Password | Regular password works |
| Hostpoint | asmtp.mail.hostpoint.ch | 587 | Password | Swiss provider |
| Swisscom | smtps.bluewin.ch | 465 | Password | Separate email password |
| GMX | mail.gmx.net | 587 | Password | Regular password |
| Naver | smtp.naver.com | 587 | App Password | Korean provider |
| Daum/Kakao | smtp.daum.net | 465 | App Password | Korean provider |
| Custom | (user input) | (user input) | Password | For other providers |

### App Password vs Regular Password
- **App Password required**: Gmail, Yahoo, iCloud, Naver, Daum
- **OAuth2**: Outlook/Microsoft (click "Connect with Microsoft" button)
- **Regular password**: Zoho, Hostpoint, GMX, Swisscom

**Note**: For detailed App Password setup instructions (step-by-step guides for each provider), refer to the IMAP node documentation. SMTP uses the same credentials as IMAP.

### Port Numbers
- **587**: STARTTLS (recommended)
- **465**: SSL/TLS (direct encryption)

---

## TEMPLATE VARIABLES

### Available Variables
| Variable | Description | Example |
|----------|-------------|---------|
| \`{{aiResponse}}\` | AI node response | Dear customer, your order... |
| \`{{message}}\` | User input message | Hello, I need help |
| \`{{context.xxx}}\` | Any context variable | \`{{context.customerEmail}}\` |
| \`{{imapResult.emails[0].subject}}\` | Email subject | Re: Your inquiry |
| \`{{imapResult.emails[0].body}}\` | Email body | Hello, ... |
| \`{{imapResult.emails[0].from}}\` | Sender address | user@example.com |
| \`{{jsonData.xxx}}\` | JSON Schema result | \`{{jsonData.summary}}\` |

### Usage Examples

**1. In "To" field:**
\`\`\`
{{context.imapResult.emails[0].from}}
\`\`\`

**2. In "Subject" field:**
\`\`\`
Re: {{imapResult.emails[0].subject}}
\`\`\`

**3. In "Body" field (Markdown supported):**
\`\`\`
# Thank you for your inquiry

{{aiResponse}}

---
Best regards,
Support Team
\`\`\`

---

## RESULT (context.smtpResult)

After SMTP node execution, result is stored in:
\`\`\`
context.smtpResult
\`\`\`

### Result Structure
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | true if sent successfully |
| messageId | string | Email Message-ID |
| subject | string | Sent email subject |
| to | string | Recipient address |
| error | string | Error message (if failed) |

### Usage in Next Node
\`\`\`
{{context.smtpResult.messageId}}
{{context.smtpResult.success}}
\`\`\`

---

## FOREACH LOOP SUPPORT

### Forward Mode in ForEach
When inside ForEach loop, SMTP automatically uses \`context.currentEmail\`:
\`\`\`
IMAP Read (multiple emails)
  → ForEach (iterate emails)
    → AI Node (generate reply)
    → SMTP Forward (auto-uses currentEmail)
\`\`\`

No need to specify Email Index - it uses the current iteration's email.

### Send Mode in ForEach
\`\`\`
Data Sheet Read (customer list)
  → ForEach (iterate customers)
    → SMTP Send
      To: {{context.currentItem.email}}
      Subject: Hello {{context.currentItem.name}}
\`\`\`

---

## MARKDOWN TO HTML

Send mode automatically converts Markdown to styled HTML:

### Supported Markdown
- **Headers**: # H1, ## H2, ### H3
- **Bold/Italic**: **bold**, *italic*
- **Lists**: - item, 1. item
- **Links**: [text](url)
- **Code**: \`inline\`, \`\`\`block\`\`\`
- **Tables**: | col1 | col2 |
- **Blockquotes**: > quote

### Dual Content
Email is sent with both:
- text/plain: Original text (for text-only clients)
- text/html: Styled HTML (for modern clients)

---

## COMMON PATTERNS

### 1. Auto-Reply
\`\`\`
IMAP Read → AI Generate Reply → SMTP Send
\`\`\`

### 2. Email Forwarding
\`\`\`
IMAP Read → If (important) → SMTP Forward (to admin)
\`\`\`

### 3. Notification
\`\`\`
Trigger → Process → SMTP Send (notify team)
\`\`\`

### 4. Bulk Email (ForEach)
\`\`\`
Data Sheet → ForEach → SMTP Send (to each customer)
\`\`\`

---

## IMAP + SMTP AUTO-SYNC

When you save SMTP connection, IMAP connection is automatically created (and vice versa).
- Same credentials are shared
- Both use the same provider settings
- Delete one = delete both (except custom provider)

---

## TROUBLESHOOTING

### "Authentication failed"
- **Gmail/Yahoo/iCloud**: Use App Password, not regular password
- **Outlook**: Use OAuth2 (Connect with Microsoft button)
- Check username is full email address

### "Connection refused"
- Verify Host/Port settings
- Port 587 for STARTTLS, 465 for SSL
- Check firewall settings

### "Message rejected"
- From address must match authenticated user
- Check recipient address format
- Some servers reject empty subject

### "Timeout"
- Check internet connection
- Verify SMTP server is accessible
- Try different port (587 vs 465)

### Microsoft OAuth2 Issues
- Token auto-refreshes (5 min buffer)
- If issues persist, delete and reconnect
- Check Azure AD app permissions

---

## RESPONSE GUIDELINES
- For questions: provide educational, helpful information (type: "answer")
- For modification requests: return changes with nodeType: "smtp" only (type: "modification")
- **NEVER include other node types** (imap, ai, dataSheet) in modification responses
- Use examples to illustrate concepts
- Recommend App Password setup guide if authentication fails
`;
