# AiTalk Workflow Guide (MCP)

Version: 15 (2026-09-28). Additive-compatible: sections may be appended, existing meanings do not change. (v15: tool `workApp` — the work app's own tool; work apps allow only Start (App) · AI · End · `workApp`, checked on every message; template `work-app`. v14: a Sub-workflow running inside an incoming **PSTN** call can read the carrier-reported caller number as `{{context.callerNumber}}` — new subsection under "Sub-workflows"; declare a `phone` input only when you want a number other than the caller's. v13: `create_workflow` accepts `kind:'sub'` — a Sub-workflow can now be created over MCP (seeded with a valid Start/Sub-workflow → End skeleton); `templateId` is rejected with `kind:'sub'`. v12: Sub-workflow Start node gained `timeoutSeconds` (whole seconds 5–60, default 15) — the calling AI's max wait; a Sub-workflow cannot be archived or deleted while another workflow still attaches it (`SUB_WORKFLOW_IN_USE`). v11: **Sub-workflows** — a workflow of kind `sub` that other workflows attach to an AI node as a tool (`toolType:'subworkflow'`, `subWorkflowId`); called by reference, never deployed; new section "Sub-workflows" below and a new row in the tool table; `list_workflows`/`get_workflow`/`validate_workflow` now return `kind`. v10: `sms` gained a node-level destination pin (`recipient`) — the table's SMS row and the pin discussion changed meaning, and voice instruction copy depends on it; plus a tool attachment missing its connection now **blocks activation** instead of deploying into a silent no-op. v9: new "AI node tools (attachments)" section — the tool-attachment contract is NOT the action-node contract the node catalog documents: per-toolType field table, `connectionId` is required and not discoverable over MCP, destination pinning as a prompt-injection control, one-tool-round limit, and webSearch ordering. v3: deploy request tool + knowledge-base source file tools. v4: conversation history read tools. v5: accuracy fixes — deployable response field names, node-level mask restore, reachability/dead-end are advisory warnings not blockers. v6: live (production) workflows are now directly editable — only archived is blocked; restore stays draft-only. v7: `deploy_workflow` / `undeploy_workflow` — MCP can now take a workflow live and off the air directly; `request_workflow_deploy` remains as the owner-confirmation alternative. v8: `get_source_file` returns the text of dashboard-uploaded files too, reassembled from the index — new `contentSource` field; documented the delete+create edit cycle; `create_source_text` no longer takes `ragProvider` (indexing is always Azure AI Search) and is managed-subscription only; `contentNote` now explains every case where text is missing or partial, and polling ends at `completed` OR `failed`.)

This guide explains how to build and manage AiTalk workflows over MCP. Read it once before using the write tools.

## Concepts

- **Account → Agents → Workflows.** An agent owns workflows, RAG sources and channel settings. A workflow is a node graph (`nodes` + `edges`) executed by the AiTalk engine.
- **Workflow status**: `draft` (editable), `production` (live — editable too, see below), `archived` (**not editable**, legacy — nothing creates this status any more). Editing a `production` workflow is allowed and takes effect for customers **immediately**, so treat it as a change to a running system: confirm with the account owner first, and prefer editing a draft and deploying it when you can test beforehand.
- **Versioning**: every content save increments `version`. **Content-mutating** write tools (`update_workflow`, `patch_workflow_params`, `restore_workflow`) require `expectedVersion` (optimistic concurrency), and so does `deploy_workflow` — so you cannot take live a graph someone changed after you validated it. `create_workflow`, `undeploy_workflow`, `request_workflow_deploy` and the source-file tools do not. Note that a status change alone (deploy / undeploy) does NOT increment `version`. On a `STALE_CONFLICT` error, re-read with `get_workflow` and retry with the fresh version.

## What you can and cannot do over MCP

You CAN:
- Read agents, workflows, node graphs, edit history (`list_agents`, `list_workflows`, `get_workflow`, `list_workflow_versions`, `get_workflow_version`).
- Create a DRAFT workflow from a **template** or blank (`create_workflow`) — including a **Sub-workflow** (`kind:'sub'`, see that section below).
- Edit a template-created workflow through its **typed parameters** (`patch_workflow_params`) — the safe, preferred path.
- Replace the entire node graph (`update_workflow`) — full assembly; read `aitalk://node-catalog` first.
- Edit a draft **or a live (production)** workflow with either editor. A live edit reaches customers immediately — confirm with the owner before making one.
- Validate a workflow (`validate_workflow`) and restore a draft to a previous version (`restore_workflow`).
- Deploy a workflow (`deploy_workflow`) — takes it LIVE for real customers immediately. Confirm with the owner first.
- Take a live workflow off the air (`undeploy_workflow`) — back to draft. NEW chats and calls stop being routed to it immediately and scheduled runs are skipped from the next tick, but a call already connected finishes normally. Ask the owner first.
- Ask the owner to confirm a deployment instead (`request_workflow_deploy`) — returns a confirmation URL they open and click Deploy on. Use this when they want to review what goes live before it does.
- Manage knowledge-base source FILES (`list_source_files`, `get_source_file`, `create_source_text`, `delete_source_file`) — see the source-files section below.
- Read conversation history (`list_conversations`, `get_conversation`) — see the conversation-history section below.

You CANNOT (by design):
- Edit an ARCHIVED workflow. `archived` is a legacy status that nothing creates any more, so you are unlikely to meet one. If you do: `deploy_workflow` can take it live (it runs the normal deploy checks) and it becomes editable then. There is **no** way to move it to draft — neither `undeploy_workflow` (it only accepts a live workflow) nor the dashboard.
- Restore a previous version onto a live (production) workflow — restore is draft-only.
- Delete workflows or agents, or manage agents/settings/connections.
- Manage non-file RAG sources: website crawls, Google Drive, SharePoint, GitBook — dashboard only.

## Recommended flow: build a workflow from a template

1. `list_workflow_templates` — pick a template (`creatable: true`).
2. `get_workflow_template(templateId)` — read its `parameters` manifest. Each parameter has:
   - `parameterId` — the key you pass to `patch_workflow_params`
   - `type` (`string` | `number` | `boolean` | `enum`) and constraints (`allowedValues`, `min`/`max`, `format`: email/cron/timezone)
   - `required: true` means the value must not be empty
3. `create_workflow({agentId, name, templateId})` — creates a draft copy. The response lists `editableParameters` and the initial `version`.
4. `patch_workflow_params({workflowId, expectedVersion, params})` — set values for one or more parameterIds. Use `dryRun: true` first if unsure; it validates without saving.
5. `validate_workflow(workflowId)` — check deploy-readiness (`deployable` level). Fix reported issues by patching parameters.
6. Go live, either way:
   - `deploy_workflow({workflowId, expectedVersion})` — takes it live immediately. Confirm with the owner first. On a workflow that is already live it changes nothing and reports `alreadyLive: true`.
   - `request_workflow_deploy(workflowId)` — issues a single-use (~15 min) deploy request and returns a `confirmationUrl`. Give that URL to the account owner: they open it logged in to their AiTalk dashboard and click Deploy to make the workflow live. Editing the draft afterwards invalidates the request (request again). Either way the same deploy checks apply, and the confirmation page always shows the workflow's current live/off state.

Notes:
- Only parameters in the manifest can be changed. Unknown parameterIds are rejected — do not guess.
- Parameters never cover credentials or connections (SendGrid/Telegram/IMAP auth is connected by the owner in Agent Studio). If a template needs a connection, tell the user to finish setup in Studio.
- If the owner later edits the workflow in Studio and removes a parameter's target node, patching that parameter returns a structured error. Report it; do not work around it.
- A workflow created blank (no templateId) has no parameters — build its graph with `update_workflow` instead.

## Full assembly: authoring raw workflowJson (update_workflow)

When no template fits, build or rewire the graph directly:

1. Read the `aitalk://node-catalog` resource — node types, required fields, enums, edge handle rules, canvas conventions. The server validates against the SAME catalog, so what the catalog requires is what the server enforces.
2. `create_workflow({agentId, name})` (blank) or start from an existing draft. For a Sub-workflow pass `kind:'sub'` — it arrives with a valid skeleton you extend (see "Sub-workflows").
3. `update_workflow({workflowId, expectedVersion, workflowJson, dryRun: true})` — validate the full graph without saving. Fix reported issues.
4. `update_workflow` without dryRun — saves if structurally valid. The response includes `deployableValid` plus `deployableBlockers` (what still blocks deployment) and `deployableWarnings` (advisory only); a draft may save with blockers outstanding. (There is NO `deployableIssues` field — read `deployableBlockers`.)
5. `validate_workflow` before handing off for deployment.

Rules that trip up most authors:
- Exactly ONE executing Start node (the first `start` in the array). Extra Starts are flagged as unreachable — a **warning**, not a hard block.
- Prefer every flow node to have a path from Start and an outgoing edge (except `end`, and while-loop bodies which may terminate). Unreachable nodes and dead ends are **advisory warnings, not deploy blockers** (see validation levels below) — but a fully orphaned node with zero incoming edges IS a blocker.
- Loop bodies hang off the while node's `loop` handle with `data.isLoopTool: true` + `data.loopOrder` — they run in loopOrder, NOT by edge chains. The `exit` handle continues the main flow.
- ifElse: every condition handle (each condition `id` + `else`) must have an outgoing edge.
- Tool attachments (`type: "tool"`) connect FROM the AI node via `sourceHandle: "tools"` and are excluded from flow-connectivity rules.
- `***masked***` values from `get_workflow` follow **node-level all-or-nothing restore**. A node that contains any mask is restored from storage ONLY if the ENTIRE node object is **deep-equal** to what `get_workflow` returned — structurally identical: same fields, same values, same array order (JSON whitespace and object key order do NOT matter). Then the real secrets are put back. If you change ANYTHING in that node — even a non-secret sibling field like a `label`, or reordering a header array — the whole node is rejected (`MASKED_VALUE_UNRESOLVED`). Moving a masked value to a NEW node/path is likewise rejected. To edit a node that holds a secret: send the real secret values, or edit it via `patch_workflow_params` / Agent Studio, or leave the node exactly as returned. Nodes with no masks have no such restriction.
- `webhook` and `email` node types exist in old data but are non-executable stubs — never author them.
- Running `update_workflow` (raw graph) on a workflow that was created from a template **clears its template binding** — afterward `patch_workflow_params` returns `NO_TEMPLATE_BINDING`. For a given workflow use raw assembly OR parameter patching, not both.

## Node basics (for reading graphs)

A node's real type is resolved from `node.type` first, then `data.nodeType` as a fallback (canvas nodes save as `type: "custom"`, so their real type lives in `data.nodeType`). Common types:

- `start` — entry point. Channel/trigger config (chat widget, schedule via `cronExpression` + `scheduleEnabled`, PSTN). Exactly one executing Start per workflow (the first in the array).
- `ai` — LLM call: `model`, `systemMessage`, `temperature`, `maxTokens`, optional tools (`selectedTools`) and structured output (`outputFormat`/`schemaProperties`).
- `end` — terminates the flow. Required for deployment.
- `tool` (attachment) — Source/RAG, web search, MCP etc. attached to an AI node via a `tools`-handle edge; not part of the main flow.
- `while` — loop. Its `loop`-handle edges point into the loop body (body chains may end without an outgoing edge); the `exit` handle continues the main flow.

Validation levels (also enforced server-side on every save/deploy):
- `structural` — parseable JSON, `{nodes, edges}` shape, unique node ids, edge endpoints exist, no cycles. Every save must pass.
- `deployable` — structural + these BLOCKING checks: has a Start and an End node, no fully-orphaned nodes (zero incoming edges), all node types runnable (no `webhook`/`email` stubs, no unknown types), node specs satisfied (required fields present). Reachability and dead-end checks run at this level too but are **advisory warnings, NOT blockers** — a graph with an unreachable node or dead end still deploys. Required to go live = the blocking checks pass.

## AI node tools (attachments) — read this before authoring any tool node

**The same nodeType means two different things depending on how it is wired.** `sendgrid`, `telegram`, `sms`, `smtp` and the calendar types each have TWO contracts, and the node catalog documents only the first one:

| | Action node (in the flow) | Tool attachment (on the AI node) |
|---|---|---|
| Shape | `type: "custom"`, `data.nodeType: "sendgrid"` | `type: "tool"`, `data.toolType: "sendgrid"` |
| Wiring | normal edge, part of the flow | edge with `sourceHandle: "tools"` from the AI node |
| Runs | always, every execution | only when the AI decides to call it |
| Values | node fields ARE the message | AI supplies the arguments; node fields only PIN them |
| Catalog `requiredFields` | apply | **do NOT apply** — see below |

### Authoring a tool attachment

```json
{ "id": "tool-sendgrid-1", "type": "tool",
  "data": { "label": "SendGrid Email", "toolType": "sendgrid",
            "nodeType": "sendgrid", "connectionId": "cmsed07t9...",
            "fromEmail": "support@example.com" } }
```
```json
{ "id": "e-ai-tool-sendgrid-1", "source": "<aiNodeId>", "sourceHandle": "tools",
  "target": "tool-sendgrid-1", "type": "default" }
```

The engine reads ONLY a fixed set of fields off each tool node and copies them onto the AI node at run time. **Everything else on the node is ignored in tool mode** — the catalog's `subject`, `bodyTemplate`, `message` are dead here. (`recipient` used to be dead too; since 2026-08-06 it is the SMS destination pin — see the table.)

| toolType | Needs a connection id | Engine reads off the node | Pins the destination (AI cannot override) | Ignored in tool mode |
|---|---|---|---|---|
| `sendgrid` | `connectionId` | `fromEmail`, `fromName`, `toEmail` | `toEmail` — **unconditional**, and it REMOVES `to` from the tool schema | `subject`, `bodyTemplate` |
| `smtp` | `connectionId` | `toEmail` | `toEmail` — **unconditional** | `mode`, `subject`, `body` |
| `telegram` | `connectionId` | `chatId` | `chatId` — but see the precedence warning below | `message` |
| `sms` | `connectionId` | `recipient` | `recipient` — **unconditional**, and it REMOVES `to` from the tool schema | `message` |
| `mcp` | `mcpConnectionId` | — | — | — |
| `google_calendar` / `microsoft_calendar` | `connectionId` | `calendarId`, `timezone`, working hours, booking policy, capacity — ~20 fields | n/a (not a messaging tool) | — |
| `webSearch` | **none** | `webSearchDomains`, `webSearchCountry`, `webSearchRegion`, `webSearchCity`, `webSearchTimezone`, `webSearchContextSize` | — | — |
| `source` | **none** | `ragSpaceId` | — | — |
| `functionCalling` | **none** | *(flag only)* | — | — |
| `workApp` | **none** | *(flag only)* | n/a — writes only to the work app's own project; loaded only when the work app itself runs it (never in the test panel or other channels) | — |
| `subworkflow` | **`subWorkflowId`** (a workflow of this agent with `kind:'sub'`, not archived — get ids from `list_workflows`) | — | n/a — the sub-workflow's own nodes decide what happens | *(the tool's name/description/parameters come from the sub-workflow's Start node, not from this attachment)* |

Attaching **two or more** calendar tools switches the AI node into Multi-Calendar mode (max 15) — a third contract again; read the `tool` entry in `aitalk://node-catalog` before authoring those.

### Destination pinning — and where the node value does NOT win

Pinning is a **security control, not a convenience**: an unpinned destination is chosen by the model from the prompt, so anything that reaches the context (RAG documents, incoming email bodies, caller speech) can redirect where a message is sent. Pin the destination whenever it is known in advance, and put only *when to send* in `systemMessage`.

⚠️ **The node value is not always the winner.** For some fields the connection's stored `serviceConfig` is read FIRST and the node value is only a fallback used when the connection has none:

| Field | Precedence |
|---|---|
| sendgrid `toEmail`, smtp `toEmail` | node value always wins → a true node-level pin |
| **telegram `chatId`** | **connection `serviceConfig.chatId` wins**; the node value applies only if the connection has none |
| **sendgrid `fromEmail`, `fromName`** | **connection `serviceConfig` wins**; the node value applies only if the connection has none |

So writing `chatId` (or `fromEmail`) onto a node is NOT a reliable way to change where a message goes: if the owner has configured it on the connection, your node value is silently ignored. Read the value back after a run, or ask the owner what the connection holds.

`sms` now pins on the node's `recipient` (E.164, e.g. `+41761234567`). When set, `to` is removed from the tool schema and the pin beats **both** the model's `to` and the PSTN caller-number fallback — leaving the fallback in place would let an injection bypass the pin just by omitting `to`. A pinned value that is not valid E.164 is rejected outright rather than falling back to some other number, and the pin is **not** template-substituted (there is no context at tool-init time), so `{{...}}` there fails every send.

Leave `recipient` empty and you get the old free mode: the destination comes from the model on every call, with a PSTN-only fallback to the reported caller number. On chat and web voice there is no fallback, so an SMS tool reachable from untrusted text is a genuine exfiltration path — **pin it**.

⚠️ Pinning changes who the message reaches, so it also changes what the agent may claim. On voice, a pinned SMS tool switches the injected rules from "send the customer a confirmation and tell them so" to a business-notification rule — do not write `systemMessage` copy that promises the caller a confirmation SMS when a pin is set.

### `connectionId` cannot be discovered over MCP

There is no tool that lists an agent's connections, and credentials come back `***masked***`. You can only reuse a `connectionId` that already appears in a `get_workflow` response for that agent. **To attach an Apps tool whose connection does not exist yet, the owner must create it in Agent Studio first** — ask them for the id, or ask them to attach the tool in the dashboard. Since v10 an Apps tool node saved **without** its connection id **blocks activation**: `deployable` returns `NODE_SPEC_VIOLATION` (with `nodeId` and `field`) and `deploy_workflow` / `request_workflow_deploy` / a `status:'production'` write all fail. Draft writes are unaffected — `update_workflow` without a status change validates `structural`, so you can save work in progress, and editing an already-live workflow is not blocked either. `mcp` tools are checked on `mcpConnectionId`, not `connectionId`. **So: get the id from the owner before you try to take the workflow live.**

### Two runtime limits that change how you write `systemMessage`

1. **There is exactly ONE tool round.** The model's first response may contain many tool calls; they all execute, and then ONE follow-up request produces the final text. **That follow-up carries no tools at all** — a second round is impossible. Chains like "look X up, then email the result" only work if the lookup is a server-side tool (below). Chains between two Apps tools do not work; use separate AI nodes, or action nodes in the flow.
2. **`webSearch` is served inside the first response — ask for it FIRST.** Unlike the Apps/MCP tools it is not a function call the engine executes; the model provider runs it while producing that first response. The executor always puts it in the same `tools` array as the function tools, so nothing in the code forces an order — but **measured behaviour** (Azure `gpt-5.6-luna`, four controlled runs) is that once the model emits function calls the turn ends, and a search listed *after* an Apps/MCP action in the instructions simply never runs. The follow-up then reports, correctly, that no web search tool is available. This is provider/model behaviour, not a guarantee of the platform: treat "put the web search first" as a strong operational rule, and verify from the run's step log rather than assuming.

`data.selectedTools` on the AI node is RECOMPUTED by the engine from the attached tool nodes on every run. Setting it by hand does nothing; attaching the tool node is what counts.

## Sub-workflows — a workflow the AI can call as a function

A **Sub-workflow** is a workflow whose `kind` is `sub` (`list_workflows` / `get_workflow` return `kind`; normal workflows are `main`). Other workflows of the **same agent** attach it to an AI node with a tool node `{type:'tool', data:{toolType:'subworkflow', subWorkflowId:'<workflowId>'}}` on the `tools` handle. At run time the AI sees one function named **`subwf_<toolName>`** and, when it calls it, the engine runs the sub-workflow and returns its End node message to the AI. Chat, STT+TTS voice and Realtime voice all load it.

What defines the tool — **the sub-workflow's Start node**, `triggerType:'subworkflow'`, with `toolName` (`^[a-z][a-z0-9_]{1,39}$`, unique among the agent's sub-workflows), `toolDescription` (what the AI reads to decide when to call it) and `inputs` (`[{name, type:'string'|'number'|'boolean', description?, required?}]`, max 10 — they become the function parameters and the sub-workflow reads them as `{{context.input.<name>}}`).

### The caller's phone number — `{{context.callerNumber}}`, not an input

On an **incoming PSTN call** the sub-workflow can read the caller's number as `{{context.callerNumber}}`. The server puts it there from the caller ID the telephony provider reported, with surrounding whitespace stripped — from the same caller-ID source the built-in calendar tool books with. It is otherwise unchanged, with one exception: a value longer than 32 characters is discarded, whatever the reason for its length. Anonymous and withheld numbers never arrive either. Any node inside the sub-workflow can read it (Data Sheets filters and rows, HTTP Request URLs and bodies, If/Else conditions, SMS `recipient`).

⚠️ **Caller ID is not authentication.** What this value guarantees is only that the model did not choose it — not that the caller is who the number belongs to; caller ID can be spoofed and it proves nothing about the subscriber. Use it for low-stakes convenience (a loyalty signup, points on a rewards account, recognising a repeat caller). Do **not** let it alone authorise anything valuable or irreversible — transferring a balance, issuing a refund, revealing another person's data. If the owner asks for that, tell them a separate confirmation step is needed and build it.

**Do not declare a `phone` input for this.** An input is filled by the model from what it heard, so it can be misheard, invented, or supplied by whatever text reached the context — and a sub-workflow that keys a signup or a points balance on it will happily write to somebody else's record. Ask for a phone as an input only when you genuinely want a number *other than* the caller's (e.g. "send the confirmation to my colleague on …").

It carries a number **only on PSTN**. On web voice, the chat widget, a scheduled run and the Test panel there is no PSTN caller ID at all, so `callerNumber` is the **empty string** — the key itself is always present.

The empty string is **not only the non-phone channels**. It also means a phone call whose number the server could not use: withheld or anonymous, or discarded by the 32-character limit above. So treat empty as *"no usable number on this call"*, never as *"not a phone call"* — an End message that says "this only works over the phone" is a lie to a caller who is on the phone. Word it around the number instead: "I can't read the number you're calling from, so I can't do this on this call."

If the sub-workflow needs the number, branch on it **first**, and use exactly this test: an `ifElse` whose condition is `conditionField: 'callerNumber'`, `conditionOperator: '!='`, `conditionValue: ''` is true exactly when a usable number is present (nothing checks its format beyond the length limit). Send the else branch to an End node whose `message` follows the wording rule above.

⚠️ The else handle does not exist until you declare it. `data.conditions` must contain **two** entries — the test and an explicit else:

```json
{ "conditions": [
  { "id": "if-0", "type": "if", "conditionMode": "simple",
    "conditionField": "callerNumber", "conditionOperator": "!=", "conditionValue": "" },
  { "id": "else", "type": "else" }
] }
```

Leave the second entry out and the `sourceHandle: "else"` edge points at a handle that does not exist: the run reaches the ifElse, matches nothing, and **stops there** — the calling AI gets `sub_workflow_no_answer` and the caller hears silence. Deployment is not blocked by this; it shows up only as an `UNREACHABLE_NODE` **warning**, so read the warnings your save returns.

🔴 **This branch is not optional when the number is a key.** Every caller without a usable number arrives as the *same* empty string, so they all collide on one filter value. The filter then cannot tell those callers apart, and Data Sheets has no unique constraint to catch it. A `read` returns whatever blank-keyed rows exist — someone else's data, or an array of several people's. An `insert` adds another row nothing can distinguish later. `update`, `upsert` and `delete` act on the rows that filter matches, which are other callers' rows. Put the guard in before every Data Sheets operation that uses `callerNumber`.

Also remember the tool can run **twice for one intent** — the model may call it again in the same turn, and a timed-out call keeps running to completion (see the run-time contract below). Reading before you write catches the *sequential* repeat, and you should still do it. It does **not** make the operation exactly-once: two runs can both read "no row" and both insert. There is no atomic compare-and-set, transaction or unique constraint available to a sub-workflow, so if the owner needs a guarantee — a signup that can never double, points that can never be credited twice — say plainly that this cannot be guaranteed here rather than shipping a read-then-write and calling it solved.

Treat the value as **text**, never as a number. The condition engine coerces operands for `>` `<` `>=` `<=` with `Number(...)`, and `Number('')` is `0` — so a numeric comparison reports a missing number as `0` rather than as absent. `!=` / `==` against `''` are the only presence tests that mean what they look like.

Two more things about this value. It is a **reserved name** — a node's `saveAs` (and `forEachItemVar`) cannot overwrite it, so nothing downstream can substitute a different number.

And it is **not normalised**: no formatting rule is applied and E.164 is not guaranteed, because AiTalk supports more than one telephony provider (Swiss ACS numbers arrive as `+41…`, the Korean 070 provider need not). **Nothing here promises a canonical key**, not even within one provider — the platform applies no formatting rule, so the only stability you get is whatever the provider's own reporting happens to give. Write it to Data Sheets as it arrives and match on that same unmodified value; reformatting one side of the comparison is what breaks lookups, and a lookup that assumes a leading `+` will miss. Tell the owner the limit rather than papering over it: the same person can end up with two rows if the reported form ever differs — most obviously when an account serves them through two providers — and de-duplicating those needs a normalisation policy this value does not provide.

Rules the validator enforces on a `kind:'sub'` workflow (structural — i.e. on **every save**, because a sub-workflow is never deployed):
- exactly one Start node and it must be `triggerType:'subworkflow'`;
- only these node types inside: `start`, `end`, `dataSheets`, `httpRequest`, `store`, `ifElse`, `while`, `continue`, `sms`, `sendgrid`, `telegram`, `smtp`, `imap` (+ pure notes). **No AI node, no wait, no tool attachments** — so a sub-workflow cannot call another sub-workflow;
- every End node must set `data.message` — that text (max 4000 chars) is what the calling AI receives (`{{context.…}}` templates work); a run that ends without reaching an End is only a warning at save time and returns `{"error":"sub_workflow_no_answer"}` at run time.

Lifecycle: sub-workflows are **called by reference and never deployed** — `deploy_workflow`, `create_workflow` with `status:'production'` and any status→production change are rejected with `SUB_WORKFLOW_NOT_DEPLOYABLE`. Consequently **saving a sub-workflow changes what live callers run immediately** — treat `update_workflow` on a `kind:'sub'` workflow like an edit to a live system. Cloning a sub-workflow keeps `kind:'sub'` and renames the tool to `<toolName>_copy`. A sub-workflow also **cannot be archived or deleted while another workflow still attaches it** — the dashboard/REST reject that with `SUB_WORKFLOW_IN_USE` and name the callers. MCP exposes no archive/delete tool, so you will never receive that code; if the owner asks you to remove a sub-workflow, tell them which workflows must detach the `subworkflow` tool first (find them with `list_workflows` + `get_workflow`).

Reference checks at save time (`SUB_WORKFLOW_REF_INVALID` / `SUB_WORKFLOW_TOOL_NAME_TAKEN`): a caller's `subWorkflowId` must point to a `kind:'sub'` workflow of the same agent that is not archived; a sub-workflow's `toolName` must not collide with another sub-workflow of the agent.

Creating one over MCP — `create_workflow({agentId, name, kind:'sub'})`:
- It comes back as a draft **seeded with a minimal valid graph**: one Start node (`triggerType:'subworkflow'`, `toolName` slugified from `name`, no inputs, default timeout) wired to one End node with `message:'Done.'`. An empty graph would fail the sub-workflow rules on the very first save, so the server seeds this instead. The response returns the seeded `toolName` and `toolFunctionName` (`subwf_<toolName>`) — the server picked the slug, not you, skipping slugs the agent's existing sub-workflows already use (`_2`, `_3`, …). That skip is best-effort: two sub-workflows created at the same instant can still collide, and the loser gets `SUB_WORKFLOW_TOOL_NAME_TAKEN` — retry with a different `name`. A `name` with no usable ASCII letters (Korean, emoji…) slugifies to nothing, so you get an unrelated `sub_workflow_<random>` instead — read `toolName` from the response rather than deriving it from `name`, and rename it in the next `update_workflow` since it is what the calling AI sees.
- Then define the real tool with `update_workflow`: set `toolName` / `toolDescription` / `inputs` / `timeoutSeconds` on the Start node and build the body (Data Sheets, HTTP Request, If/Else, While, messaging nodes). Read `aitalk://node-catalog` first, and `dryRun: true` before saving.
- A non-empty `templateId` is **rejected** with `kind:'sub'` (`SUB_WORKFLOW_TEMPLATE_UNSUPPORTED`) — every template is a channel-triggered main workflow. Create it blank and assemble it. (An empty string counts as omitted, here and everywhere else.)
- There is **no deploy step**. Attach it to a caller's AI node (`{type:'tool', data:{toolType:'subworkflow', subWorkflowId}}` on the `tools` handle) and it starts being callable as soon as that caller is saved — immediately for a live caller.

Run-time contract the AI receives: the End message on success; fixed JSON `{"error":"sub_workflow_failed"}` when a node fails, `{"error":"sub_workflow_no_answer"}` when no End with a message was reached, `{"error":"sub_workflow_invalid_arguments","reason":…}` when the call's arguments do not match `inputs` (required, type coercion, string ≤2000 chars, ≤8KB total; unknown keys are dropped), and `{"error":"sub_workflow_timeout","note":"may still complete"}` after the Start node's `timeoutSeconds` (a whole number of seconds, 5–60, default 15 — decimals/exponents are rejected) — a timeout is **not** a failure: the run keeps going and its side effects may still land; on a voice call the caller hears silence for that long, so keep it short and keep loops (`while`) small enough to finish inside it. Idempotency is not provided: the model may call the same tool twice, even in parallel within one turn — a duplicate check inside the sub-workflow only protects sequential calls.

## Work apps — Start triggerType 'app'

A workflow whose Start node has `triggerType:'app'` is a **work app**: after it is deployed, the agent owner and invited team members open it as a work app (tasks, sheets and notes beside the chat).
- It must be a main workflow with **exactly one Start node** (`APP_START_RULE`) — a second Start would let another channel run it.
- The chat widget, team chat, Telegram, voice and the mobile app **never run it**, even when it is the most recently deployed workflow — they pick another production workflow. Calling `/api/chat` with its id answers "not found".
- Optional Start fields: `appTemplate` (a known app template, e.g. `'vat'` — Swiss VAT; leave it empty to let the user choose in the first chat) and `appWelcomeMessage`.
- **Only Start (App), AI, End and the `workApp` tool are allowed** — any other node or tool (email, SMS, web search, MCP, HTTP, sub-workflow, calendar, wait) blocks the work app chat at run time. The allowed list is checked on every message, not only at deploy.
- The work app adds its own context to the AI instructions on every turn (app template guide, project notes, sheet summary) — do not copy it into `systemMessage`. Template `work-app` is a ready Start (App) → AI (`gpt-6-sol`, image input, `workApp` tool) → End.

## Error handling

Tool errors return structured JSON: `{error, code, ...details}`. Key codes:
- `STALE_CONFLICT` — re-read, retry with fresh `expectedVersion`.
- `PARAM_VALIDATION_FAILED` — `issues[]` lists each bad parameter and why.
- `NO_TEMPLATE_BINDING` — workflow was not created from a template over MCP; parameters unavailable.
- `WORKFLOW_STRUCTURE_INVALID` / `WORKFLOW_NOT_DEPLOYABLE` — `issues[]` lists graph problems with node ids.
- `DRAFT_REQUIRED` — the workflow is archived. Only `deploy_workflow` can bring it back (to production); there is no path to draft.
- `PRODUCTION_RESTORE_BLOCKED` — the workflow is live; a previous version can only be restored on a draft.
- `SUB_WORKFLOW_NOT_DEPLOYABLE` — the workflow is a Sub-workflow (`kind:'sub'`); it is called by reference and cannot go to production.
- `SUB_WORKFLOW_TEMPLATE_UNSUPPORTED` — `create_workflow` got both `templateId` and `kind:'sub'`. Create the sub-workflow blank (skeleton is seeded) and assemble it with `update_workflow`.
- `SUB_WORKFLOW_REF_INVALID` / `SUB_WORKFLOW_TOOL_NAME_TAKEN` — a `subworkflow` tool points at a missing/archived/non-sub workflow, or the sub-workflow's `toolName` collides with another sub-workflow of the agent (see "Sub-workflows"). Structural issues with code `SUB_WORKFLOW_RULE` explain which sub-workflow rule a graph breaks.

## Knowledge-base source files (RAG)

An agent answers from its knowledge base (RAG). Over MCP you can manage its **file-type sources** only:

- `list_source_files(agentId)` — metadata + indexing `status` per file: `processing` (not searchable yet), `completed` (indexed and searchable), `failed` (see `errorMessage`), `deleting` (a deletion is in progress; normally gone within seconds — if it lingers, a cleanup failed and deleting again is safe).
- `get_source_file(agentId, storageId)` — one file incl. its text `content` (truncated at ~50KB). `contentSource` says where the text came from: `stored` (the original text as submitted) or `indexed_chunks` (reassembled from the search index — the **extracted** text the AI actually searches, which is what dashboard-uploaded PDF/DOCX/… files give you: layout, images and tables are lost). `null` means no text was returned — and then `contentNote` tells you *why*, which matters because the cases need different responses:
  - indexing not finished yet → poll (`status` is `processing`).
  - the file holds no extractable text (e.g. a scanned image) → nothing to read, do not retry.
  - **an index lookup failure** → retry once. If it keeps failing, do not assume the document is empty or broken and do not "fix" it by deleting and re-adding — some causes (configuration, index state) survive that. Report it to the owner, who can check the file on the dashboard Storage page.
  - **the account has no active managed region** (retained or suspended subscription) → **retrying will not help.** The metadata you already have is still accurate; say so instead of promising a retry.
  - for a very long document you may get `contentSource: indexed_chunks` **with** a note that only the beginning could be read back — the tail is missing, so never summarise it as if it were the whole document.
- `create_source_text(agentId, title, content)` — add a plain-text document (saved as a `.txt` source, max 1MB).
- `delete_source_file(agentId, storageId)` — remove the file AND its indexed chunks. Irreversible.

Rules and gotchas:
- **Indexing is asynchronous.** `create_source_text` returns `status: "processing"` — the document is NOT searchable yet. Poll `get_source_file` until `status` is `"completed"` — **or `"failed"`, which also ends the polling** (read `errorMessage` then). Usually seconds to a few minutes. Only after `completed` should you tell the user it is live, and before testing agent answers that depend on it.
- **Binary files cannot be transferred over MCP.** If the user asks to add a PDF/DOCX/PPTX/XLSX/image: convert or extract it to plain text or markdown locally in YOUR environment (you usually have file access), then `create_source_text` with the text. Otherwise direct the user to the dashboard Storage page, which uploads binaries natively.
- **There is no in-place update.** To fix a document: `get_source_file` (read the current text) → edit it → `delete_source_file` → `create_source_text`. Two consequences to tell the user about: the file is not searchable during the gap between delete and the new document reaching `completed`, and if the original was a binary it comes back as a `.txt` — the uploaded PDF/DOCX itself is gone (re-upload it in the dashboard if they need the original kept).
- Website crawls, Google Drive, SharePoint and GitBook imports are not accessible over MCP — they never appear in `list_source_files` and cannot be deleted from here.
- Indexing goes into Azure AI Search — there is no provider to choose. `ragSpaceId` optionally files the document under a specific RAG space (omit for the Default space). Accounts that are not on a managed subscription cannot add documents over MCP (`UNSUPPORTED_SERVICE_VARIANT`) — direct the user to the dashboard Storage page.
- Deleting a source file removes real indexed data the agent may be answering from — confirm with the user before `delete_source_file` unless they explicitly named the file.
- A file cannot be deleted while it is still `processing` (`SOURCE_FILE_PROCESSING`) — wait for `completed`/`failed`, then delete.
- If `delete_source_file` fails with `CLEANUP_FAILED`, the indexed data could not be removed and the file was **deliberately kept** so the deletion can be retried — call it again rather than treating the file as gone.

## Conversation history (read-only)

The agent's past conversations with the owner's customers — text chats, voice calls (PSTN phone + web voice) and quiz attempts:

- `list_conversations({agentId?, source?, since?, until?, limit?, offset?})` — entries newest first. `source` filters the channel (`all` | `text` | `voice` | `quiz`); `since`/`until` are ISO 8601 timestamps. Each entry has a `preview`, token totals, and for voice calls `voiceMeta` (duration, language; PSTN entries include the caller's phone number).
- `get_conversation({conversationId, messageOffset?, messageLimit?})` — the full decrypted transcript, oldest first.

How to read the data:
- **One entry = one conversation start or one voice call.** Voice calls are grouped **per visitor per day** under a single `conversationId`, so several list entries (one per call) can share a `conversationId`. `get_conversation` returns the whole day's group; `boundary: true` marks where each call starts, and each message's `sessionId` tells the calls apart.
- **Long transcripts are windowed.** If `nextMessageOffset` is non-null there are more messages — call again with `messageOffset` set to it. Individual messages longer than ~8KB come back truncated (`contentTruncated: true`).
- **Quiz entries** return a result summary (score, question counts) instead of messages; per-question detail is only in the dashboard History page.
- History is **read-only** — there are no tools to edit or delete conversations.

Personal data: history contains the owner's customer data — names, phone numbers (PSTN caller numbers), emails and whatever was said in the conversation. It is exposed here because the account owner is reading their own data. Use it strictly for the owner's request (e.g. summarizing, searching, analytics), quote only what is needed, and never send it to third-party services or include it in outputs the owner did not ask for.
