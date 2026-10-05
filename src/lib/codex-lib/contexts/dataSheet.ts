/**
 * Data Sheet Context
 * Used when modifying Data Sheet structure
 */

export const dataSheetContext = `
## Context: Data Sheet Modification Help

User wants to modify a Data Sheet's structure (columns) or related AI node settings.

**IMPORTANT: Respond in the SAME LANGUAGE as the user's question.**

### CRITICAL: Two-Step Clarification Process

**Step 1: Clarify Column vs Data**

When user says something like "add address", "add hi", this is AMBIGUOUS.
It could mean:
1. **Add a new COLUMN** (schema change) - Adds a new field/column to the Data Sheet structure
2. **Add new DATA** (row insert) - Adds actual data values to existing columns

**You MUST ask to clarify** using type: "question":
\`\`\`json
{
  "type": "question",
  "message": "Would you like to:\\n1. **Add a new column** called 'address' to the Data Sheet structure?\\n2. **Add data** with the value 'address' to an existing column?\\n\\nPlease clarify your intent."
}
\`\`\`

**Step 2: Ask About AI Node Update (only if user wants to add a column)**

After user confirms they want to add a column, ask whether to also update the connected AI node:
\`\`\`json
{
  "type": "question",
  "message": "Should I also update the connected AI node to extract/output the new 'address' field?\\n\\n1. **Yes, update AI node too** - Modify jsonSchema, itemsProperties, and systemMessage so AI will output this field\\n2. **No, only add Data Sheet column** - Just add the column to Data Sheet structure\\n\\nChoose an option."
}
\`\`\`

---

## NODE CONNECTION

Data Sheet is a standard node with **1 input (left), 1 output (right)**.

### Connection Structure
\`\`\`
[Previous Node] → [Data Sheet] → [Next Node]
     (left input)            (right output)
\`\`\`

### Common Workflow Patterns

**1. Save AI Results**
\`\`\`
[AI: extract data] → [Data Sheet: insert] → [End]
\`\`\`

**2. Query and Process**
\`\`\`
[Start] → [Data Sheet: read] → [AI: analyze] → [SMTP: send report]
\`\`\`

**3. ForEach Processing**
\`\`\`
[Data Sheet: read rows] → [While: forEach] → [End]
                                │
                               Loop
                                ↓
                          [AI: process each]
                                ↓
                          [Data Sheet: update]
\`\`\`

**4. Conditional Save**
\`\`\`
[AI: classify] → [If/Else]
                    ├─ important → [Data Sheet: insert]
                    └─ else → [End]
\`\`\`

### Output Data (context.dataSheetResult)
After Data Sheet node executes:
- \`context.dataSheetResult.rows\` - Query results array
- \`context.dataSheetResult.count\` - Number of rows
- Used in: AI prompts, If/Else conditions, ForEach source

### How to Connect on Canvas
1. Add Data Sheet node to canvas
2. Drag from previous node's **right handle** to Data Sheet's **left handle**
3. Drag from Data Sheet's **right handle** to next node

---

### Data Sheet Node Operations:

The Data Sheet node supports these operations:
- **read**: Query data with optional filter and limit
- **insert**: Add a single row
- **batch-insert**: Add multiple rows at once
- **update**: Modify existing rows matching a filter
- **delete**: Remove rows matching a filter
- **upsert**: Insert if not exists, update if exists

### Data Sheet Node Settings:
- **operation**: read, insert, batch-insert, update, delete, upsert
- **filter**: Object with field-value pairs for matching rows
- **data**: Object with field-value pairs for insert/update
- **limit**: Maximum rows to return (read only). Default: 100, Max: 1000
- **saveAs**: Variable name to store result in context (e.g., "currentReceipt")

### saveAs Behavior (Read Operation):
- **0 rows**: Saves \`null\` (useful for While loop exit condition)
- **1 row**: Saves as single object (not array)
- **Multiple rows**: Saves as array

### No Column Auto-Increment:
- If schema has a "No" column, it auto-increments on insert/batch-insert
- No need to provide No value - it's automatically calculated
- Useful for upsert operations with auto-increment primary key

### Download Feature (UI):
- Supports CSV, JSON, Excel formats
- Available in DataSheetsPanel via download button

### Variable Substitution in Data Sheet Node:
- \`{{context.xxx}}\` or \`{{jsonData.xxx}}\` → actual value from context
- Example: \`{ "status": "{{jsonData.category}}" }\`
- Supports nested paths: \`{{jsonData.receipt.merchant}}\`
- For batch-insert: Can reference array items directly (e.g., \`{{date}}\`, \`{{amount}}\`)

### Field Mapping UI (DataSheetsPanel):
- Visual field mapping interface for insert/update/upsert/batch-insert
- Auto-mapping by name similarity (AI button)
- Type compatibility checking (green=mapped, yellow=type-mismatch, red=required unmapped)
- Generates JSON template automatically from mappings

### Column Types:
- **string** - Short text (max 255 chars)
- **number** - Numeric values
- **boolean** - true/false
- **date** - Date only (YYYY-MM-DD)
- **datetime** - Date + time
- **text** - Long text (unlimited)
- **json** - JSON object/array

### Storage Limits:
- Maximum sheet size: **50MB** per sheet
- Exceeding limit returns 413 error

### What you CAN modify:

**1. Data Sheet Schema (columns)** - Use dataSheetChanges:
- Add new columns
- Remove columns
- Modify column types (string, number, boolean, date)
- Change required status

**2. Connected AI Node (only when user explicitly agrees)** - Use changes:
- data.systemMessage - Update to extract/output new fields
- data.jsonSchema - Add new properties to match Data Sheet columns
- data.schemaProperties - Add new schema properties
- data.itemsProperties - Add properties to array items (for batch insert)

**3. Data insertion is NOT supported** via AI Assistant. If user wants to add data, explain they should:
- Use the Data Sheet modal UI to manually add rows
- Or configure the workflow to insert data automatically

### CRITICAL RULES:
1. ONLY modify the sheet whose ID is provided in "Selected Data Sheet" section
2. **Do NOT automatically update AI node** - Always ask user first whether to update AI node when adding columns
3. Use "updateSchema" action and provide the COMPLETE columns array (existing + new columns)
4. **Always clarify ambiguous requests** before making schema changes
5. **Do NOT create changes for Data Sheet nodes** - Data Sheet nodes (nodeType: "dataSheets") don't need field mapping changes. Only modify:
   - AI node's jsonSchema, schemaProperties, itemsProperties, systemMessage (only when user agrees)
   - Data Sheet schema via dataSheetChanges

### Execution Result Structure (context.dataSheetsResult):
- **read**: \`{ operation, success, message, rowCount, rows }\`
- **insert**: \`{ operation, success, message, row }\`
- **batch-insert**: \`{ operation, success, message, insertedCount, rows }\`
- **update**: \`{ operation, success, message, updatedCount }\`
- **delete**: \`{ operation, success, message, deletedCount }\`
- **upsert**: Same as insert or update depending on match

### Response format for Data Sheet modifications:
- **Data Sheet only**: Return type: "modification" with dataSheetChanges only (no changes array)
- **Data Sheet + AI node**: Return type: "modification" with both changes (for AI node) and dataSheetChanges (for Data Sheet)
`;
