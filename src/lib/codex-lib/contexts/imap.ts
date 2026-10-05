/**
 * IMAP Context
 * Used when configuring IMAP node for email automation
 */

export const imapContext = `
## Context: IMAP Email Node Help

User wants to understand and configure the IMAP node for email automation.
This context is EDUCATIONAL - focus on explaining concepts, not modifying workflow.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### CRITICAL: This is an INFORMATION-ONLY context
- Do NOT return type: "modification" responses
- ONLY return type: "answer" responses with educational content
- Help users understand IMAP concepts, settings, and best practices

### Beginner Guide (PRIORITY)

When user asks "what is IMAP?", "help", "explain IMAP":
\`\`\`json
{
  "type": "answer",
  "message": "## What is IMAP?\\n\\n**IMAP (Internet Message Access Protocol)** is a standard protocol for reading and managing emails on a mail server.\\n\\n### IMAP vs POP3\\n- **IMAP**: Manages emails on server (stays synced)\\n- **POP3**: Downloads emails then deletes from server\\n\\n### IMAP Use Cases in Workflows\\n- Auto-read new emails\\n- Auto-classify spam\\n- Auto-forward important emails\\n- Auto-organize/archive emails"
}
\`\`\`

---

## NODE CONNECTION

IMAP is a standard node with **1 input (left), 1 output (right)**.

### Connection Structure
\`\`\`
[Previous Node] → [IMAP] → [Next Node]
     (left input)      (right output)
\`\`\`

### Common Workflow Patterns

**1. Email Classification**
\`\`\`
[Start] → [IMAP: read] → [AI: classify] → [If/Else] → [IMAP: move]
\`\`\`

**2. With While Loop (ForEach)**
\`\`\`
[IMAP: read emails] → [While: forEach] → [End]
                            │
                           Loop
                            ↓
                      [AI: process each]
                            ↓
                      [IMAP: move/archive]
\`\`\`

**3. Email Forwarding**
\`\`\`
[Start] → [IMAP: read] → [AI: summarize] → [SMTP: forward]
\`\`\`

### Output Data (context.imapResult)
After IMAP node executes, \`context.imapResult\` is available:
- Used by next nodes: AI prompt, If/Else condition, SMTP forward
- In ForEach: \`context.currentEmail\` for each iteration

### How to Connect on Canvas
1. Add IMAP node to canvas
2. Drag from previous node's **right handle** to IMAP's **left handle**
3. Drag from IMAP's **right handle** to next node's **left handle**

---

## EMAIL PROVIDER & PASSWORD GUIDE

### App Password vs Regular Password

When user asks "what is App Password?", "password error", "authentication failed":

**App Password**:
- Used for accounts with 2FA (Two-Factor Authentication) enabled
- A separate 16-character password generated specifically for apps
- Required when external apps need email access

**Which providers require App Password:**
| Provider | App Password Required | Notes |
|----------|----------------------|-------|
| **Gmail** | ✅ Yes | Enable 2FA → Google Account → Security → App Passwords |
| **iCloud** | ✅ Yes | Apple ID → Security → App-Specific Passwords |
| **Yahoo** | ✅ Yes | Yahoo Account Security → Generate App Password |
| **Outlook.com** | ❌ OAuth2 | Uses OAuth2 authentication (button click) |
| **Naver** | ✅ Yes | Enable 2FA → Generate App Password |
| **Daum/Kakao** | ✅ Yes | Account Settings → App Password |
| **Zoho** | ❌ No | Regular password works |
| **Hostpoint** | ❌ No | Regular password works |
| **Swisscom** | ❌ No | Email-specific password (regular) |
| **GMX** | ❌ No | Regular password works |

**Example response for App Password question:**
\`\`\`json
{
  "type": "answer",
  "message": "## What is App Password?\\n\\nA special password generated for external app access on security-enhanced email services.\\n\\n### Why is it needed?\\n- Regular password won't work with 2FA enabled\\n- App passwords grant access only to specific apps/services\\n- Can revoke individual app passwords if compromised\\n\\n### Providers requiring App Password\\n- ✅ Gmail, iCloud, Yahoo, Naver, Daum\\n- ❌ Outlook (uses OAuth2), Zoho, Hostpoint, GMX\\n\\n### How to generate Gmail App Password\\n1. Google Account → Security → Enable 2-Step Verification\\n2. Security → App Passwords\\n3. Select app (Mail) → Select device → Generate\\n4. Copy the 16-character password"
}
\`\`\`

---

## CUSTOM IMAP SETTINGS

When user asks "what is Host?", "what is Port?", "custom IMAP settings":

**Host**: Email server address
- Gmail: \`imap.gmail.com\`
- Outlook: \`outlook.office365.com\`
- Yahoo: \`imap.mail.yahoo.com\`
- iCloud: \`imap.mail.me.com\`
- Custom: Contact your company/hosting provider

**Port**: Server connection port number
- **993** (default): SSL/TLS encrypted (recommended)
- **143**: Unencrypted (security risk)

**Example response:**
\`\`\`json
{
  "type": "answer",
  "message": "## Custom IMAP Settings\\n\\n### Host\\nThe email server address.\\n- Gmail: \`imap.gmail.com\`\\n- Outlook: \`outlook.office365.com\`\\n- Company email: Contact your hosting provider\\n\\n### Port\\nThe port number for server connection.\\n- **993**: SSL/TLS encrypted (✅ Recommended)\\n- **143**: Unencrypted (❌ Security risk)\\n\\n### Common Settings\\n| Service | Host | Port |\\n|---------|------|------|\\n| Gmail | imap.gmail.com | 993 |\\n| Outlook | outlook.office365.com | 993 |\\n| Yahoo | imap.mail.yahoo.com | 993 |\\n| iCloud | imap.mail.me.com | 993 |"
}
\`\`\`

---

## ACTION GUIDE

When user asks about Actions ("explain actions", "what is Read?", "how to use Move?"):

### Actions Explained:

**1. Read**
- Basic action to fetch emails
- Options:
  - **Folder**: Target folder (default: INBOX)
  - **Only unread emails**: Fetch only unread emails
  - **Max emails**: Maximum number of emails to fetch

**2. Move**
- Move email to another folder
- Removes from original folder
- Example: Move spam from INBOX to Spam folder

**3. Copy**
- Copy email to another folder
- Keeps original
- Example: Backup important emails to Archive

**4. Delete**
- Permanently delete email
- ⚠️ Cannot be undone
- Use with caution

**5. Mark Read**
- Mark email as read
- No content changes
- Used to mark processed emails

**6. List Folders**
- Get all available folders on the server
- Returns folder paths, names, and special use flags
- Useful to check actual folder names before Move/Copy

**7. Batch Move** (Advanced)
- Move multiple emails based on AI classification results
- Single IMAP connection for all moves (better performance)
- Requires: batchSource (path to classification array), folderMapping (category → folder)
- Example: AI classifies emails → batchMove sends each to the correct folder

**Example response:**
\`\`\`json
{
  "type": "answer",
  "message": "## IMAP Actions Explained\\n\\n### 📖 Read\\nFetches email content.\\n- **Folder**: Target folder (INBOX, Sent, etc.)\\n- **Only unread**: ✅ Fetch unread only\\n- **Max emails**: Maximum to fetch at once\\n\\n### ➡️ Move\\nMoves email to another folder.\\n- Removes from original folder\\n- Example: Auto-move spam to Spam folder\\n\\n### 📋 Copy\\nCopies email to another folder.\\n- Keeps original\\n- Example: Backup important emails to Archive\\n\\n### 🗑️ Delete\\nPermanently deletes email.\\n- ⚠️ Cannot be undone!\\n\\n### ✅ Mark Read\\nMarks email as 'read'.\\n- Used to mark processed emails\\n\\n### 📁 List Folders\\nGets all folders from server.\\n- Shows actual folder paths\\n- Includes special use flags (Spam, Trash, etc.)\\n\\n### 📦 Batch Move (Advanced)\\nMoves multiple emails based on AI classification.\\n- Single connection for better performance\\n- Requires classification array and folder mapping"
}
\`\`\`

---

## SETTINGS GUIDE

When user asks about specific settings:

### Folder
- Specifies the email folder to work with
- Common folders: INBOX, Sent, Drafts, Spam, Trash
- Gmail special: [Gmail]/Spam, [Gmail]/Trash
- System auto-converts: "Spam" → actual folder path

### Only unread emails
- ✅ Checked: Fetch only UNSEEN emails
- ❌ Unchecked: Fetch all emails
- Recommended: Check when processing new emails only

### Max emails
- Maximum number of emails to fetch at once
- Default: 10
- Too large = longer processing time
- Set appropriate value when using with scheduler

### Email UID
- Unique identifier for each email
- Used in Move/Copy/Delete/Mark Read actions
- Get from previous Read result: \`{{imapResult.emails[0].uid}}\`
- In ForEach loop: \`{{context.currentEmail.uid}}\`

**Example response:**
\`\`\`json
{
  "type": "answer",
  "message": "## IMAP Settings Details\\n\\n### 📁 Folder\\nThe email folder to work with.\\n- INBOX: Inbox\\n- Sent: Sent folder\\n- Spam: Spam folder\\n- Trash: Trash folder\\n\\n### 📬 Only unread emails\\nFetch only unread emails.\\n- ✅ Recommended for processing new emails\\n- ❌ Uncheck if you need all emails\\n\\n### 🔢 Max emails\\nMaximum emails to fetch at once.\\n- Default: 10\\n- Recommended: 5-20 (depending on scheduler interval)\\n\\n### 🆔 Email UID\\nUnique ID to specify a particular email.\\n- From Read result:\\n  \`{{imapResult.emails[0].uid}}\`\\n- In ForEach loop:\\n  \`{{context.currentEmail.uid}}\`"
}
\`\`\`

---

## COMMON USE CASES

When user asks "how to use?", "use case", "examples":

### 1. Auto Spam Classification
\`\`\`
Start (Schedule: every 15 min)
  → IMAP Read (Only unread)
  → AI Node (Classify spam/normal)
  → If/Else
    → Spam: IMAP Move (to Spam folder)
    → Normal: Keep
\`\`\`

### 2. Auto Email Forwarding
\`\`\`
Start (Schedule)
  → IMAP Read
  → AI Node (Analyze importance)
  → If (Important)
    → SMTP Forward (to admin)
  → IMAP Mark Read
\`\`\`

### 3. Auto Customer Inquiry Processing
\`\`\`
IMAP Read
  → AI Node (Classify inquiry type)
  → Data Sheet (Save inquiry)
  → SMTP (Auto reply)
\`\`\`

---

## RESULT FIELDS (Developer Info)

When user asks "how to use result?", "how to access in next node?", "result fields":

### IMAP Result Structure

After IMAP Read action, results are stored in:
\`\`\`
context.imapResult
\`\`\`

### Available Fields

| Field | Description | Example |
|-------|-------------|---------|
| \`emails[].uid\` | Email UID (may change after Move) | \`{{context.imapResult.emails[0].uid}}\` |
| \`emails[].messageId\` | Email unique ID (never changes) | \`{{context.imapResult.emails[0].messageId}}\` |
| \`emails[].subject\` | Email subject | \`{{context.imapResult.emails[0].subject}}\` |
| \`emails[].from\` | Sender address | \`{{context.imapResult.emails[0].from}}\` |
| \`emails[].to\` | Recipient address | \`{{context.imapResult.emails[0].to}}\` |
| \`emails[].date\` | Received date | \`{{context.imapResult.emails[0].date}}\` |
| \`emails[].body\` | Plain text body | \`{{context.imapResult.emails[0].body}}\` |
| \`emails[].bodyHtml\` | HTML body (if available) | \`{{context.imapResult.emails[0].bodyHtml}}\` |

### UID vs Message-ID
- **UID**: Server-assigned, may change after Move operation
- **Message-ID**: RFC 822 header, never changes, used for reliable email tracking in ForEach loops

### Usage Examples

**1. In AI Node (System Message):**
\`\`\`
Analyze the following email:
Subject: {{context.imapResult.emails[0].subject}}
From: {{context.imapResult.emails[0].from}}
Body: {{context.imapResult.emails[0].body}}

Classify as: spam, important, or normal
\`\`\`

**2. In ForEach Loop:**
\`\`\`
{{context.currentEmail.uid}}
{{context.currentEmail.subject}}
{{context.currentEmail.body}}
\`\`\`

**3. In IMAP Move/Delete (Email UID):**
\`\`\`
{{context.imapResult.emails[0].uid}}
or in ForEach:
{{context.currentEmail.uid}}
\`\`\`

**Example response:**
\`\`\`json
{
  "type": "answer",
  "message": "## How to Use IMAP Results\\n\\n### Result Location\\nStored in \`context.imapResult\`\\n\\n### Available Fields\\n| Field | Description |\\n|-------|-------------|\\n| \`emails[].uid\` | Email unique ID |\\n| \`emails[].subject\` | Subject |\\n| \`emails[].from\` | Sender |\\n| \`emails[].date\` | Received date |\\n| \`emails[].body\` | Body content |\\n\\n### Usage in AI Node\\n\`\`\`\\nAnalyze this email:\\nSubject: {{context.imapResult.emails[0].subject}}\\nBody: {{context.imapResult.emails[0].body}}\\n\`\`\`\\n\\n### Usage in ForEach Loop\\nFor processing multiple emails:\\n\`{{context.currentEmail.subject}}\`"
}
\`\`\`

---

## ADVANCED FEATURES

### Connection Caching (ForEach Loops)

When processing multiple emails in ForEach loop, IMAP uses connection caching:
- Single connection reused for all operations
- Prevents Gmail/Zoho rate limiting issues
- Auto-cleanup after 30 seconds of inactivity

### Multilingual Folder Names

The system automatically maps folder names in different languages:

| English | Korean | German | French | Spanish |
|---------|--------|--------|--------|---------|
| Spam | 스팸편지함 | Spam | Spams | Correo no deseado |
| Trash | 휴지통 | Papierkorb | Corbeille | Papelera |
| Sent | 보낸편지함 | Gesendet | Envoyés | Enviados |
| Drafts | 임시보관함 | Entwürfe | Brouillons | Borradores |
| Inbox | 받은편지함 | Posteingang | Boîte de réception | Bandeja de entrada |

**Example**: User inputs "Spam" → System finds "스팸편지함" on Korean mail server

### Microsoft OAuth2 (Outlook)

Outlook.com/Office365 uses OAuth2 authentication:
1. Click "Connect with Microsoft" button
2. Authorize the app in Microsoft login page
3. IMAP connection is automatically configured
4. Tokens are auto-refreshed (no manual renewal needed)

**Note**: Gmail/iCloud/Yahoo require App Password instead of OAuth2

### ListFolders Result

When using listFolders action, results include:
\`\`\`
context.imapResult.folders = [
  { path: "INBOX", name: "INBOX", specialUse: "\\\\Inbox" },
  { path: "[Gmail]/Spam", name: "Spam", specialUse: "\\\\Junk" },
  { path: "MyLabel", name: "MyLabel", specialUse: undefined }
]
\`\`\`

### BatchMove Configuration

For AI-powered email classification:
\`\`\`
batchSource: "jsonData.classifications"
folderMapping: {
  "spam": "Spam",
  "important": "Important",
  "newsletter": "Newsletters",
  "default": "General"
}
\`\`\`

Classification array format:
\`\`\`
[
  { "uid": 123, "category": "spam" },
  { "uid": 124, "category": "important" },
  { "uid": 125, "category": "newsletter" }
]
\`\`\`

---

## TROUBLESHOOTING

When user reports errors:

### "Authentication failed"
- Check if App Password is required
- App Password is mandatory when 2FA is enabled
- Enter password without spaces

### "Connection refused"
- Verify Host/Port settings
- Use port 993 (recommended)
- Check firewall settings

### "Folder not found"
- Verify exact folder name
- Gmail format: [Gmail]/Spam
- Folder names are case-sensitive

### Response Guidelines:
- Always provide educational, helpful information
- Do NOT suggest modifying the workflow
- Use examples to illustrate concepts
- Recommend App Password setup guide if authentication fails
`;
