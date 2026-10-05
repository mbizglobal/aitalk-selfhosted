/**
 * If/Else Context
 * Used when configuring If/Else node for conditional branching
 */

export const ifElseContext = `
## Context: If/Else Node Configuration

User wants to understand and configure the If/Else node for conditional branching.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### Response Types
- **Educational questions** (what is, how to, explain) → type: "answer"
- **Setting changes** (change operator to, set field to) → type: "modification"

---

## NODE CONNECTION (Core Concept)

If/Else node has **1 input, multiple outputs** for conditional branching.

### Input Handle (Left)
- **Position**: Left center of node (Top when used as Loop Tool)
- **Connection**: Connect from previous node (AI, IMAP, Data Sheet, etc.)
- **Data**: Previous node output stored in context for condition evaluation

### Output Handles (Right)
Each condition has its own output handle, dynamically generated:

| Condition Type | Handle ID | Description |
|----------------|-----------|-------------|
| If | \`if-0\` | First condition (required) |
| Else-If | \`else-if-{timestamp}\` | Additional conditions |
| Else | \`else\` | Default branch (optional) |

### Connection Flow
\`\`\`
[AI Node] → [If/Else] → [SMTP] (when condition is true)
              ↓
           [IMAP] (when condition is false)
\`\`\`

**Execution Rules:**
- Conditions evaluated **top to bottom**
- Only the **first true condition's** connected node executes
- If all conditions are false, Else branch executes (or workflow ends if no Else)

### Example: Email Classification
\`\`\`
[IMAP] → [AI: classify] → [If/Else]
                              │
                              ├─ If: category == "spam" ─────→ [IMAP: move to Spam]
                              ├─ Else-If: category == "support" → [SMTP: forward]
                              └─ Else ───────────────────────→ [IMAP: archive]
\`\`\`

### How to Connect on Canvas
1. Drag from previous node's **output handle** (right dot) to If/Else **input handle** (left)
2. Drag from each If/Else **condition handle** (right dots) to next nodes
3. Handles are automatically added when conditions are added

---

## THREE CONDITION MODES

### 1. Simple Mode (Default)
Single condition with field, operator, and value.
- **conditionField**: Variable path (e.g., \`jsonData.category\`)
- **conditionOperator**: Comparison operator
- **conditionValue**: Value to compare against

### 2. Builder Mode
Multiple conditions with AND/OR logic.
- **conditionLogic**: \`all\` (AND) or \`any\` (OR)
- **conditions**: Array of condition objects

### 3. Code Mode (Advanced)
Custom JavaScript expression.
- **customExpression**: Free-form JS expression
- Example: \`jsonData.score > 85 && jsonData.isApproved == true\`

**Code Mode Special Features:**
- **Literal strings**: \`"true"\` → always true, \`"false"\` → always false
- **Variable access**: Both \`jsonData.score\` and \`context.jsonData.score\` work
- **Full JS support**: \`&&\`, \`||\`, \`()\`, comparison operators, string methods

**Code Mode Examples:**
\`\`\`javascript
// Simple boolean
true

// AND condition
jsonData.score > 85 && jsonData.isApproved == true

// OR condition
jsonData.category == "urgent" || jsonData.priority > 5

// Grouped conditions
jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")

// String methods
jsonData.email.includes("@company.com")

// Using context prefix (same result)
context.jsonData.needsRetry == true
\`\`\`

**Mode Conversion:**
- Simple → Builder: Condition becomes first item in array
- Simple → Code: Generates expression string
- Builder → Code: Joins conditions with && or ||
- Code → Simple/Builder: Resets to defaults (parsing difficult)

---

## OPERATORS (Actual Symbols)

| Symbol | Name | Example |
|--------|------|---------|
| \`==\` | equals | \`category == "spam"\` |
| \`!=\` | not equals | \`status != "done"\` |
| \`>\` | greater than | \`score > 85\` |
| \`<\` | less than | \`count < 10\` |
| \`>=\` | greater or equal | \`amount >= 100\` |
| \`<=\` | less or equal | \`priority <= 3\` |
| \`contains\` | substring match | \`subject contains "urgent"\` |
| \`startsWith\` | prefix match | \`email startsWith "admin"\` |
| \`endsWith\` | suffix match | \`file endsWith ".pdf"\` |

---

## VALUE TYPES

| Type | Description | Example |
|------|-------------|---------|
| \`boolean\` | true/false | \`isApproved == true\` |
| \`number\` | Numeric values | \`score > 85\` |
| \`string\` | Text values | \`category == "spam"\` |

**Auto-detection:** When selecting a field from dropdown, value type is automatically set based on field type.

---

## AVAILABLE FIELDS (Auto-detected)

The dropdown shows fields from **previous nodes** in the workflow:

| Source Node | Available Fields |
|-------------|------------------|
| AI (JSON Schema) | \`jsonData.fieldName\` - fields defined in schema |
| Data Sheet | \`dataSheetResult.rows\`, \`dataSheetResult.count\` |
| IMAP | \`imapResult.emails[0].subject\`, \`.from\`, \`.body\` |
| While/ForEach | \`currentItem\`, \`loopIndex\` |
| System | \`message\` (user input) |

**How it works:**
1. Panel analyzes workflow edges to find upstream nodes
2. Extracts output fields from each node type
3. Shows in dropdown with type info (boolean, number, string)

**No fields available?**
- Add an AI node with JSON Schema before If/Else
- Or use Code mode for manual field paths

---

## CONTEXT OUTPUT (context.ifElseResult)

After If/Else node execution:
\`\`\`json
{
  "ifElseResult": {
    "matchedCondition": "spam-branch",  // caseName or id
    "matchedHandle": "if-0",            // Output handle id
    "conditionType": "if"               // "if", "else-if", or "else"
  }
}
\`\`\`

---

## ELSE-IF BRANCHES

You can add multiple Else-If conditions dynamically:
- Click **"+ Else If"** to add new branch
- Each branch gets its own output handle
- Conditions are evaluated **top to bottom**
- First matching condition wins

**Structure:**
\`\`\`
If: score >= 90       → "Excellent" branch
Else If: score >= 70  → "Good" branch
Else If: score >= 50  → "Pass" branch
Else:                 → "Fail" branch
\`\`\`

---

## INCLUDE BRANCHES IN LOOP

**Setting:** \`includeBranchesInLoop\` (default: true)

When If/Else is inside While/ForEach loop:
- **ON (true)**: Branch actions execute within each loop iteration
- **OFF (false)**: Branch actions skipped, only condition evaluated

**Use Case:** Email processing loop
\`\`\`
ForEach email:
  AI → categorize
  If/Else → route by category
    spam → IMAP move to Spam (executes per email)
    support → SMTP forward (executes per email)
    Else → IMAP archive (executes per email)
\`\`\`

---

## MODIFIABLE FIELDS

For type: "modification" responses:

| Field | Type | Description |
|-------|------|-------------|
| \`conditionMode\` | "simple" \\| "builder" \\| "advanced" | Condition mode |
| \`conditionField\` | string | Variable path (Simple mode) |
| \`conditionOperator\` | string | Comparison operator |
| \`conditionValue\` | any | Value to compare |
| \`conditionLogic\` | "all" \\| "any" | AND/OR logic (Builder mode) |
| \`conditions\` | array | Condition array (Builder mode) |
| \`customExpression\` | string | JS expression (Code mode) |
| \`caseName\` | string | Optional label for branch |
| \`includeBranchesInLoop\` | boolean | Execute branches in loop |

### Modification Examples

**Change operator:**
User: "change operator to >="
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "conditionOperator", "value": ">=" }],
  "summary": "Changed operator to >="
}
\`\`\`

**Change condition field:**
User: "set field to jsonData.score"
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "conditionField", "value": "jsonData.score" }],
  "summary": "Changed condition field to jsonData.score"
}
\`\`\`

**Change value:**
User: "set value to 85"
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "conditionValue", "value": 85 }],
  "summary": "Changed value to 85"
}
\`\`\`

**Switch to Code mode:**
User: "switch to code mode"
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "conditionMode", "value": "advanced" }],
  "summary": "Switched to Code mode"
}
\`\`\`

**Set custom expression:**
User: "set condition to jsonData.score > 85 && jsonData.isApproved == true"
\`\`\`json
{
  "type": "modification",
  "changes": [
    { "nodeId": "current", "field": "conditionMode", "value": "advanced" },
    { "nodeId": "current", "field": "customExpression", "value": "jsonData.score > 85 && jsonData.isApproved == true" }
  ],
  "summary": "Set custom expression with AND condition"
}
\`\`\`

**Toggle includeBranchesInLoop:**
User: "disable branches in loop"
\`\`\`json
{
  "type": "modification",
  "changes": [{ "nodeId": "current", "field": "includeBranchesInLoop", "value": false }],
  "summary": "Disabled branch execution in loop"
}
\`\`\`

**Multiple changes:**
User: "set condition to check if jsonData.category equals spam"
\`\`\`json
{
  "type": "modification",
  "changes": [
    { "nodeId": "current", "field": "conditionField", "value": "jsonData.category" },
    { "nodeId": "current", "field": "conditionOperator", "value": "==" },
    { "nodeId": "current", "field": "conditionValue", "value": "spam" }
  ],
  "summary": "Set condition: jsonData.category == spam"
}
\`\`\`

---

## USING VARIABLES

### From AI Node (JSON Schema)
\`\`\`
Field: jsonData.category
Operator: ==
Value: "spam"
\`\`\`

### From Data Sheet
\`\`\`
Field: dataSheetResult.count
Operator: >
Value: 0
\`\`\`

### From IMAP
\`\`\`
Field: imapResult.emails[0].from
Operator: contains
Value: "@company.com"
\`\`\`

---

## COMMON PATTERNS

### 1. Retry Logic (While Loop)
\`\`\`
Field: jsonData.needsRetry
Operator: ==
Value: true
\`\`\`

### 2. Quality Threshold
\`\`\`
Field: jsonData.score
Operator: <
Value: 85
\`\`\`

### 3. Approval Check
\`\`\`
Field: jsonData.isApproved
Operator: ==
Value: false
\`\`\`

### 4. Code Mode Complex Condition
\`\`\`javascript
jsonData.amount > 100 && (jsonData.status == "pending" || jsonData.status == "review")
\`\`\`

---

## TROUBLESHOOTING

### Condition always false
- Verify variable path in Test panel
- Check value type matches (boolean vs string "true")
- Use \`contains\` for case-insensitive partial match

### Type mismatch
- Boolean: Use \`== true\` or \`== false\`, not string
- Number: Don't wrap in quotes (\`85\` not \`"85"\`)
- String: Check for extra whitespace

### No branch executed
- Add Else branch as fallback
- Check if previous node produced expected output
- Verify conditionLogic (all vs any) in Builder mode
`;
