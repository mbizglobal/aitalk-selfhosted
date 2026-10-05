
import { NODE_CATALOG } from '@/lib/workflow/node-catalog-data'
import { isSelfHosted } from '@/lib/edition'
import { SELFHOSTED_OFF_FEATURES } from '@/lib/edition-features'

let cache: string | null = null

function editionNote(): string[] {
  if (!isSelfHosted()) return []
  const pick = (k: 'nodeKinds' | 'triggers' | 'toolTypes' | 'miniApps') =>
    SELFHOSTED_OFF_FEATURES.flatMap((f) => f[k] ?? []).map((v) => `\`${v}\``).join(', ')
  return [
    '**This installation does not include** these parts — a workflow that uses any of them is rejected on save and will not run:',
    `node types ${pick('nodeKinds')} · Start triggerType ${pick('triggers')} · AI tool toolType ${pick('toolTypes')} · Mini Apps ${pick('miniApps')}.`,
    '',
  ]
}

export function renderNodeCatalog(): string {
  if (cache !== null) return cache

  const lines: string[] = [
    '# AiTalk Node Catalog',
    '',
    'Version: 5 (2026-09-13). Additive-compatible: node types and fields may be added; existing meanings do not change. (v5: the Voice Quiz Mini App note used to name only its two required hooks, so a workflow authored from this catalog could ship with no sign-up and no way to stop the calls — it now spells out all four Sub-workflow slots, which two are required, and that signupSubWorkflowId lives on data rather than inside hooks. v4: two authoring-shape corrections found by actually building a workflow through MCP — (a) a new "Canvas node types" table: `type: "custom"` is NOT universal, and a node drawn with the wrong `type` runs fine but renders as an unnamed empty box in the dashboard; (b) the ifElse handle rules now spell out that the "else" handle exists only when data.conditions holds an explicit {type:"else"} entry — an edge to a handle you never declared is dead, and it only warns. v3: the start node notes say a Sub-workflow reads the PSTN caller number as {{context.callerNumber}} rather than through a declared input. v2: any-of requirements, array shape requirements, advisory fields, clamped-enum notes.)',
    '',
    ...editionNote(),
    'Schema reference for authoring `workflowJson` with `update_workflow`. Every node is',
    '`{ id, type, data: { nodeType, label, ... }, position: {x, y} }` — the real type is resolved from `node.type` first, then `data.nodeType`',
    'Most canvas nodes use `type: "custom"` and carry their real type in `data.nodeType`, but **some node types have their own `type`** — see "Canvas node types" below and use the one listed there.',
    'Edges are `{ id, source, target, sourceHandle? }`.',
    '',
    'Server-side validation enforces this catalog at deploy time (`validate_workflow` level `deployable`):',
    'required fields, conditional requirements, enum values, and rejection of unknown or non-executable types.',
    'Saving a draft only requires graph integrity (`structural`), so you can build incrementally.',
    '',
    '## Canvas node types',
    '',
    'The engine and the validator resolve a node from `node.type` first and then `data.nodeType`, so a wrong `type` still RUNS correctly.',
    'The dashboard canvas, however, picks the component to draw purely from `node.type` — get it wrong and the owner sees an unnamed empty',
    'box instead of the node, with no icon, no title and no settings summary. Always pair `data.nodeType` with the `type` in this table:',
    '',
    '| `data.nodeType` | required `type` |',
    '|---|---|',
    '| `dataSheets` | `dataSheets` |',
    '| `branch` (ifElse / condition) | `ifElse` |',
    '| `while` | `while` |',
    '| `wait` | `wait` |',
    '| `continue` | `continue` |',
    '| `note` | `note` |',
    '| a tool attachment (`data.toolType`) | `tool` |',
    '| everything else (`start`, `ai`, `end`, `sendgrid`, `telegram`, `smtp`, `imap`, `store`, `httpRequest`, `sms_*`, `pstn`, …) | `custom` |',
    '',
    '## Canvas conventions',
    '',
    '- ifElse nodes are saved as `type: "ifElse"` + `data.nodeType: "branch"` (a UI marker — both work for execution, but the canvas needs `type: "ifElse"`).',
    '- Tool attachment nodes often duplicate their toolType into `data.nodeType` (e.g. "google_calendar"); the type stays `tool`.',
    '- Loop body nodes hang off the while node\'s `loop` handle with `data.isLoopTool: true` + `data.loopOrder` (execution order is loopOrder, not edge chains).',
    '- Credentials are NEVER in node data — they live in WorkflowConnections set up by the account owner in Agent Studio.',
    '',
  ]

  for (const spec of Object.values(NODE_CATALOG)) {
    lines.push(`## ${spec.nodeType}${spec.notExecutable ? ' ⛔ (not executable)' : ''}`)
    lines.push('')
    lines.push(spec.description)
    lines.push('')
    if (spec.requiredFields.length > 0) {
      lines.push(`**Required:** ${spec.requiredFields.map(f => `\`${f}\``).join(', ')}`)
    }
    for (const req of spec.arrayRequirements ?? []) {
      lines.push(`**Shape:** \`${req.field}\` must be a non-empty array${req.someTruthyKey ? ` with at least one entry where \`${req.someTruthyKey}\` is set` : ''}`)
    }
    for (const rule of spec.conditionalRequired ?? []) {
      const parts: string[] = []
      if (rule.require?.length) parts.push(rule.require.map(f => `\`${f}\``).join(', '))
      for (const group of rule.requireAnyOf ?? []) parts.push(`one of ${group.map(f => `\`${f}\``).join(' / ')}`)
      for (const req of rule.requireArray ?? []) parts.push(`\`${req.field}\` as a non-empty array${req.someTruthyKey ? ` (≥1 entry with \`${req.someTruthyKey}\` set)` : ''}`)
      if (parts.length) lines.push(`**Required when \`${rule.whenField}\`="${rule.equals}":** ${parts.join(' · ')}${rule.defaultsTo ? ` — also applies when \`${rule.whenField}\` is absent or invalid (both fall back to "${rule.equals}")` : ''}`)
    }
    for (const field of spec.advisoryRequiredFields ?? []) {
      lines.push(`**Advisory:** without \`${field}\` the node runs but is a no-op (validation reports a warning, not a blocker)`)
    }
    const enumEntries = Object.entries(spec.enums)
    if (enumEntries.length > 0) {
      lines.push(`**Enums:** ${enumEntries.map(([f, vals]) => `\`${f}\` ∈ [${vals.join(', ')}]${spec.clampedEnums?.includes(f) ? ' (invalid values fall back to the default at runtime — warning only, not a deploy blocker)' : ''}`).join(' · ')}`)
    }
    const optEntries = Object.entries(spec.optionalFields)
    if (optEntries.length > 0) {
      lines.push('')
      lines.push('| Field | Meaning |')
      lines.push('|---|---|')
      for (const [field, desc] of optEntries) {
        lines.push(`| \`${field}\` | ${desc.replace(/\|/g, '\\|')} |`)
      }
    }
    lines.push('')
    lines.push(`**Handles:** ${spec.sourceHandles}`)
    lines.push('')
    lines.push(spec.notes)
    lines.push('')
  }

  cache = lines.join('\n')
  return cache
}
