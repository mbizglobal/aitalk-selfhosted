
import type { NodeSpec } from './node-catalog'

export const NODE_CATALOG: Record<string, NodeSpec> = {

  start: {
    nodeType: 'start',
    description:
      'Entry node — the executor is a pass-through; triggerType selects which external path invokes the workflow (chat widget, cron scheduler, Telegram webhook, incoming PSTN call).',
    requiredFields: [],
    optionalFields: {
      triggerType: 'Trigger variant (absent = chat widget)',
      accessMode: "'public' or 'team' (who can invoke via chat widget)",
      scheduleEnabled: 'schedule: active only when true AND cronExpression exists',
      cronExpression: 'schedule: cron string driving the scheduler',
      scheduleTimezone: "schedule: IANA timezone (default 'UTC')",
      greeting: 'pstn: initial call greeting',
      language: "pstn: STT/voice locale (default 'de-CH')",
      voiceName: 'pstn: TTS voice',
      endCallPhrase: "pstn: phrase that ends the call (default 'goodbye')",
      maxSilenceSeconds: 'pstn: silence timeout (default 2)',
      noResponseMessage: 'pstn: message on caller silence',
      goodbyeMessage: 'pstn: closing message',
      phoneNumber: 'pstn: bound phone number (managed in the dashboard, not over MCP)',
      toolName: "subworkflow: function name the calling AI uses (2-40 chars, ^[a-z][a-z0-9_]{1,39}$; exposed as 'subwf_<toolName>'; unique among the agent's sub-workflows)",
      toolDescription: 'subworkflow: what the tool does — the calling AI reads this to decide when to call it (max 1000 chars)',
      inputs: "subworkflow: [{name, type:'string'|'number'|'boolean', description?, required?}] (max 10) — becomes the function's parameters; the sub-workflow reads them as {{context.input.<name>}}",
      appTemplate: "app: the work app template this app uses (e.g. 'vat' — Swiss VAT). Absent = the user picks one in the first chat, or builds a new structure. Only apps opened from /chat/[agentId]/app run this workflow — the chat widget, team chat, Telegram and voice never run a work app",
      appWelcomeMessage: 'app: first message shown when the work app opens',
      timeoutSeconds: 'subworkflow: how long the calling AI waits for the result — a WHOLE number of seconds 5–60 (default 15; decimals, exponents and signs are rejected; a numeric string like "20" is accepted). Past it the AI receives {"error":"sub_workflow_timeout","note":"may still complete"} while the run keeps going — on a voice call the caller hears silence for that long',
    },
    enums: { triggerType: ['chatWidget', 'schedule', 'telegram', 'pstn', 'subworkflow', 'app'] },
    sourceHandles: 'default only',
    notes:
      'Exactly one executing Start per workflow — the engine uses the FIRST start node in the array; extra Starts never run. Schedule fields are consumed at save time (WorkflowSchedule sync), pstn voice fields by the voice bridges. ' +
      "triggerType 'subworkflow' is only valid in a workflow whose kind is 'sub' (a Sub-workflow — see the tool node's toolType 'subworkflow'); it defines the tool the calling AI sees and is rejected in a normal ('main') workflow. " +
      "A Sub-workflow running inside an incoming PSTN call also reads the caller's number as {{context.callerNumber}} without declaring an input for it: the server supplies it, so do NOT add a 'phone' input to capture the caller's own number (the model would fill that from what it heard). It is the empty string on every other channel AND on a phone call whose number is unusable (withheld/anonymous, or longer than 32 characters), it is not authentication, and it is not normalised — read the \"caller's phone number\" part of the Sub-workflows section in aitalk://workflow-guide before using it as a key.",
  },

  end: {
    nodeType: 'end',
    description:
      'Terminal node — assembles the final answer (context.finalAnswer) from a priority chain: data.message > dataSheetsResult table > finalAnswer > jsonData.aiResponse > aiResponse.',
    requiredFields: [],
    optionalFields: { message: 'Custom final message; non-empty wins over everything else' },
    enums: {},
    sourceHandles: 'none — no outgoing edges (dead-end check exempts end)',
    notes: 'Required for deployment. JSON AI responses are hidden in chat unless displayJsonInChat is set on the AI node.',
  },

  while: {
    nodeType: 'while',
    description:
      "Loop container — 'while' mode re-evaluates a condition each iteration, 'forEach' mode iterates an array from context; loop body nodes hang off the 'loop' handle.",
    requiredFields: [],
    optionalFields: {
      loopMode: "'while' (default) or 'forEach'",
      maxIterations: 'Cap (default 10 in while mode, 100 in forEach)',
      conditionMode: "while: 'simple' (default) | 'builder' | 'advanced'/'code'",
      conditionField: "simple: context path ('context.' prefix auto-stripped)",
      conditionOperator: 'simple: comparison operator',
      conditionValue: 'simple: comparison value',
      conditionLogic: "builder: 'all'=AND (default) | 'any'=OR",
      conditions: 'builder: [{field, operator, value}]',
      customExpression:
        "advanced/code: restricted expression, NOT JavaScript (lib/workflow/safe-expression.ts). Supports: comparison (== != === !== > < >= <=), logical (&& || !), parentheses, literals (number, \"string\", true/false/null), context paths (a.b[0].c — must be template-readable, see lib/workflow/template-scope.ts), and the string methods includes/startsWith/endsWith with a literal argument. NOT supported: function calls, arithmetic, ternary, assignment, template literals, globals. Anything outside the grammar evaluates to false",
      forEachSource: "forEach: array path (e.g. 'imapResult.emails') — loop is a 0-iteration no-op without it",
      forEachItemVar: "forEach: context var for current item (default 'currentItem')",
    },
    enums: {
      loopMode: ['while', 'forEach'],
      conditionMode: ['simple', 'builder', 'advanced', 'code'],
      conditionOperator: ['==', '!=', '>', '<', '>=', '<=', 'contains', 'startsWith', 'endsWith'],
      conditionLogic: ['all', 'any'],
    },
    clampedEnums: ['loopMode'],
    conditionalRequired: [{ whenField: 'loopMode', equals: 'forEach', require: ['forEachSource'] }],
    sourceHandles:
      "'loop' = loop body — ALL body nodes hang directly off the while node's 'loop' handle and run by data.loopOrder ascending (NOT by edge chaining; each needs data.isLoopTool=true). 'exit' = post-loop continuation.",
    notes:
      "Loop body nodes need isLoopTool:true + loopOrder. An empty while-mode condition evaluates false (0 iterations). Result in context.whileResult; a wait node inside the loop pauses and resumes at the exact iteration.",
  },

  ifElse: {
    nodeType: 'ifElse',
    description:
      "Conditional branch — evaluates data.conditions top-to-bottom and routes out of the first matching condition's handle.",
    requiredFields: ['conditions'],
    arrayRequirements: [{ field: 'conditions' }],
    optionalFields: {
      conditions:
        "Array of condition objects; each carries its own conditionMode/conditionField/conditionOperator/conditionValue (simple), conditionLogic+conditions (builder) or customExpression (advanced — restricted expression, not JavaScript; see the while node's customExpression). type:'else' always matches. conditionField must be a template-readable context path (see lib/workflow/template-scope.ts)",
      includeBranchesInLoop: 'As a loop tool: whether a branch target outside the loop is executed inline (default true)',
    },
    enums: {},
    sourceHandles:
      "One handle per entry in data.conditions, with id = that entry's id (e.g. 'if-0', 'else-if-...'). " +
      "The 'else' handle is NOT automatic: it exists only if data.conditions contains an entry with type:'else' " +
      "(e.g. {id:'else', type:'else'}) — add that entry FIRST, then draw the edge with sourceHandle:'else'. " +
      "Every branch handle must have an outgoing edge. If no condition matches and there is no else entry the flow simply STOPS here " +
      "(the engine logs 'No condition matched and no Else branch exists'), which inside a Sub-workflow means the caller gets sub_workflow_no_answer. " +
      "An edge whose sourceHandle names a handle you never declared is dead: validation reports its target as an UNREACHABLE_NODE warning, which does NOT block deployment — read the warnings.",
    notes:
      "Canvas saves this node as type:'ifElse' with data.nodeType:'branch' — 'branch' is a UI marker, the engine resolves by node.type. 'condition' is a legacy alias executed by the same executor.",
  },

  continue: {
    nodeType: 'continue',
    description: 'Loop-control marker — inside a While/ForEach loop it ends the current iteration immediately; outside a loop it is a pass-through.',
    requiredFields: [],
    optionalFields: {
      isLoopTool: 'Must be true (with loopOrder) to be picked up as a loop body node',
      loopOrder: 'Position in the loop body sequence',
    },
    enums: {},
    sourceHandles: 'default only (irrelevant inside a loop)',
    notes: 'Remaining loop body nodes after it are skipped, then the loop re-evaluates / advances.',
  },

  wait: {
    nodeType: 'wait',
    description:
      "Pauses the workflow for user input — persists execution state with status 'waiting'; on the user's next message execution resumes past this node.",
    requiredFields: [],
    optionalFields: {
      waitMessage: "Message shown while waiting; {{context.x}} templates supported (default 'Waiting for user input...')",
      displayMode: "'message' = show only waitMessage (skip the automatic table rendering of aiResponse)",
    },
    enums: { displayMode: ['message'] },
    sourceHandles: 'default only — on resume the engine proceeds along this edge',
    notes: 'Inside a While loop, wait suspends the loop and resume re-enters at the exact iteration and body position. There is NO timeout: the pause lasts until the user replies. Legacy nodes may still carry a timeoutMinutes field — it is ignored (the editor stopped offering it on 2026-08-07). Waiting state that nobody resumes is deleted after 7 days by the retention cleanup, after which the next message restarts the workflow from the beginning.',
  },

  ai: {
    nodeType: 'ai',
    description:
      'LLM call with optional RAG (Source), web search, MCP and Apps tools attached via tool nodes; streams text or returns structured JSON.',
    requiredFields: [],
    optionalFields: {
      model: "Model id (default 'gpt-6-luna'); Managed regions auto-fallback if unavailable",
      systemMessage: "Instructions; {{context.x}} templates supported (default 'You are a helpful assistant')",
      provider: "LLM provider (default 'openai')",
      temperature: 'Default 0.7 (ignored for gpt-5* models)',
      maxTokens: 'Default 2048',
      topP: 'Default 1.0 (only sent for gpt-4.1, gpt-4.1-mini, gpt-4o-mini — NOT full gpt-4o)',
      topK: 'Non-OpenAI providers only: top-k sampling (ignored on the OpenAI path)',
      effort: 'gpt-5*: reasoning effort',
      verbosity: 'gpt-5*: text verbosity',
      summary: 'gpt-5*: reasoning summary',
      outputFormat: "'text' (default, streaming) | 'json' (sync, json_schema)",
      jsonSchema: "outputFormat='json': the JSON schema actually read by the executor (string or object)",
      schemaProperties: 'UI authoring form that GENERATES jsonSchema — the executor does not read it; if you set one, keep both in sync',
      schemaName: 'UI schema name feeding the jsonSchema wrapper',
      includeChatHistory: 'Default true',
      imageInput: 'Enable image file input (vision models only)',
      pdfInput: 'Enable PDF file input',
      csvInput: 'Enable CSV file input (parsed and injected into the prompt)',
      displayJsonInChat: "outputFormat='json': show the JSON result in chat (hidden by default)",
      vectorStoreId: 'Direct OpenAI vector store id used as a file_search fallback — a Source tool node is preferred',
      saveAs: 'Extra context variable for parsed JSON (besides context.jsonData)',
      saveTempStorage: 'Persist parsed JSON to temp storage (for wait/resume flows)',
      loadTempStorage: 'Prepend previous temp JSON to input',
      isLoopTool: 'true when this node is a While loop body node',
      loopOrder: 'Position in the loop body sequence',
      selectedTools: 'Booleans gating tool loading — RECOMPUTED by the engine from attached tool nodes on every run; setting it manually without attaching tool nodes has no effect',
    },
    enums: {
      provider: ['openai', 'gemini', 'claude', 'deepseek', 'grok'],
      outputFormat: ['text', 'json'],
      effort: ['low', 'medium', 'high'],
      verbosity: ['low', 'medium', 'high'],
    },
    clampedEnums: ['verbosity'],
    sourceHandles:
      "Attachments: sourceHandle='tools' → tool nodes (source/webSearch/mcp/functionCalling/sendgrid/telegram/sms/smtp/google_calendar/microsoft_calendar), sourceHandle='miniapps' → Mini App node. Normal flow continues via the edge with no sourceHandle.",
    notes:
      "Tool config (connection IDs, web search domains, calendar settings) lives on the ATTACHED tool nodes and is copied onto the AI node by the engine at run time — author tools as tool nodes + 'tools' edges, not as AI data fields. " +
      "⚠️ An Apps/MCP tool node is a DIFFERENT contract from the same-named action node: its own catalog entry's requiredFields do not apply, and message-content fields on it are ignored because the AI supplies them. sendgrid/telegram/sms/smtp/calendar tool nodes need data.connectionId (mcp needs mcpConnectionId; webSearch/source/functionCalling need none). " +
      "Two runtime limits shape systemMessage: (1) there is exactly ONE tool round — every tool call comes from the first response, and the single follow-up request carries NO tools (both the sync and streaming paths), so Apps-tool-to-Apps-tool chains are impossible; " +
      "(2) webSearch is served by the provider inside the first response rather than executed by the engine, and MEASURED behaviour is that emitting a function call ends the turn — so when combining web search with Apps/MCP tools, instructions that ask for the search first get it and instructions that ask for it later often do not. This is model behaviour, not a code guarantee; confirm from the run's step log. " +
      "Read the 'AI node tools' section of aitalk://workflow-guide before authoring tool attachments.",
  },

  source: {
    nodeType: 'source',
    description:
      "RAG connector — resolves the account's RAG provider and injects vector store / search config into context for the downstream AI node.",
    requiredFields: [],
    optionalFields: {
      ragProvider: 'Informational display of the resolved provider (the actual provider comes from account settings)',
      ragSpaceId: "Azure AI Search only: RAG space ID (invalid → Default space fallback)",
    },
    enums: {},
    sourceHandles: "Attached TO an AI node via the AI node's 'tools' handle (node shape: type:'tool', data.toolType:'source').",
    notes:
      'Misconfiguration (no vector store, no provider key) produces a warning and RAG is silently skipped — never a workflow error.',
  },

  file_search: {
    nodeType: 'file_search',
    description: "Passes a vectorStoreId into context for the downstream AI node's file_search tool (legacy — prefer a source tool node).",
    requiredFields: [],
    advisoryRequiredFields: ['vectorStoreId'],
    optionalFields: {},
    enums: {},
    sourceHandles: 'default only',
    notes: 'No-op without vectorStoreId. Lowest priority — a Source node or the AI node data.vectorStoreId wins.',
  },

  mcp: {
    nodeType: 'mcp',
    description:
      'Standalone MCP client node — connects to an external MCP server, lists tools, optionally calls one; results in context.mcpTools / context.mcpResult.',
    requiredFields: ['mcpConnectionId'],
    optionalFields: {
      mcpToolName: 'Tool to call after listing (absent = tools/list only)',
      mcpToolArgs: 'Arguments — object or JSON string',
    },
    enums: {},
    sourceHandles: 'default only',
    notes:
      "Connection (server URL + auth) lives in a WorkflowConnection. Distinct from the AI-node MCP tool attachment (type:'tool', toolType:'mcp') where MCP tools become LLM function calls.",
  },

  tool: {
    nodeType: 'tool',
    description:
      "Attachment node hung off an AI node via the 'tools' handle (or 'miniapps' for the Mini App variant) — not part of the flow; the engine reads its data and configures the AI node.",
    requiredFields: ['toolType'],
    conditionalRequired: [
      { whenField: 'toolType', equals: 'sendgrid', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'telegram', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'sms', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'smtp', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'google_calendar', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'microsoft_calendar', require: ['connectionId'] },
      { whenField: 'toolType', equals: 'mcp', require: ['mcpConnectionId'] },
      { whenField: 'toolType', equals: 'subworkflow', require: ['subWorkflowId'] },
    ],
    optionalFields: {
      parentId: 'AI node id (informational — the engine resolves attachment via the edge, not this)',
      connectionId: 'Required for sendgrid/telegram/sms/smtp/calendar tool types — enforced at deploy',
      mcpConnectionId: "toolType='mcp': connection copied to the AI node",
      ragSpaceId: "toolType='source': RAG space (the source tool node IS the source node)",
      webSearchDomains: "toolType='webSearch': comma/newline domain allowlist (max 20)",
      fromEmail: "toolType='sendgrid': sender", toEmail: "toolType='sendgrid'/'smtp': recipient",
      chatId: "toolType='telegram': chat ID",
      calendarId: "calendar tool types: target calendar (+ ~20 more calendar config fields)",
      subWorkflowId: "toolType='subworkflow': workflowId of a Sub-workflow (kind 'sub', same agent, not archived) — its Start node defines the function the AI sees",
    },
    enums: {
      toolType: ['source', 'webSearch', 'mcp', 'functionCalling', 'sendgrid', 'telegram', 'sms', 'smtp', 'google_calendar', 'microsoft_calendar', 'miniapp', 'subworkflow', 'workApp'],
    },
    sourceHandles: "Target of the AI node's 'tools' (or 'miniapps') edge; no outgoing flow edges. Excluded from flow-connectivity validation.",
    notes:
      "Saved tool nodes often duplicate the toolType into data.nodeType (e.g. 'google_calendar') — the type is still 'tool'. Mini App variant: toolType:'miniapp' + miniAppType one of 'quiz' (Start triggerType 'schedule', run by the engine) or 'voice_quiz' (Start triggerType 'pstn', run by the call session), attached via the 'miniapps' handle. voice_quiz has FOUR Sub-workflow slots; each slot holds a workflow id, and that id must be the one in data.subWorkflowId of a Sub-workflow tool node attached to the SAME AI node's 'tools' handle (the slot itself is never called data.subWorkflowId). REQUIRED: data.hooks.onRoundStart (membership check + open the round) and data.hooks.onRoundSettle (reward payout) — leave either empty and deploy is refused, because the call would ask questions that pay nothing. OPTIONAL: data.signupSubWorkflowId (sign up the caller by their phone number) and data.hooks.onMemberChange (stop the calls, delete the membership, save the time of day to call next). ⚠ signupSubWorkflowId sits directly on data, NOT inside hooks — put it under hooks and nothing reads it, so sign-up never turns on and no error is reported. Each optional slot is silent when empty: validation reports nothing and ONLY the feature in that slot is disabled — an empty signupSubWorkflowId means nobody can join, an empty onMemberChange means nobody can stop or leave. Omit either one only when you intend to ship without that feature. ≥2 calendar tools switch the AI node to Multi-Calendar mode (max 15). " +
      "Note: which tool types take effect depends on the channel — the workflow engine's own run wires source/webSearch/mcp/sendgrid/telegram/smtp/calendar on whichever AI node is executing, while the chat widget and voice channels load Apps tools (including sms) from the FIRST AI node's 'tools' edges only. An sms tool attached to a later AI node is therefore never consumed. " +
      "Sub-workflow tool (toolType 'subworkflow', data.subWorkflowId): exposes another workflow of the same agent (kind 'sub') as a function named 'subwf_<toolName>' whose parameters come from that sub-workflow's Start node (triggerType 'subworkflow': toolName/toolDescription/inputs). Chat, STT+TTS voice and Realtime voice all load it. Sub-workflows are called by reference — never deployed (deploying one is rejected), so SAVING a sub-workflow changes what live callers run immediately. Inside a sub-workflow only these node types are allowed: start/end/dataSheets/httpRequest/store/ifElse/while/continue/sms/sendgrid/telegram/smtp/imap (no AI node, no wait, no nested sub-workflow tool). Its End node MUST set data.message — that text (max 4000 chars) is what the calling AI receives; a run that ends without a message, fails, or times out returns a fixed JSON error ({\"error\":\"sub_workflow_no_answer\"|\"sub_workflow_failed\"|\"sub_workflow_timeout\"} — timeout means the run MAY still complete). Arguments are validated against inputs (required, type coercion, string ≤2000 chars, ≤8KB total; unknown keys dropped). Idempotency is NOT provided: the model may call the same tool twice, even in parallel within one turn — a duplicate-check inside the sub-workflow only protects sequential calls.",
  },

  imap: {
    nodeType: 'imap',
    description:
      'Reads and manages emails on an IMAP server (read, move, copy, delete, mark read, batch move, list folders); result stored in context.imapResult.',
    requiredFields: ['action'],
    optionalFields: {
      connectionId: "WorkflowConnection ID to select a specific IMAP connection; falls back to the agent's first IMAP connection",
      folder: "Source folder (default 'INBOX')",
      onlyUnseen: 'read: fetch only unseen emails (default true)',
      maxEmails: 'read: max emails to fetch, most recent N (default 10)',
      targetFolder: 'move/copy: destination folder',
      emailUid: 'move/copy/markRead: email UID, template vars supported (e.g. {{context.currentEmail.uid}})',
      uidToDelete: 'delete: UID to delete',
      uidToMark: 'markRead: UID to mark (emailUid takes precedence)',
      batchSource: "batchMove: context path to classification array (e.g. 'jsonData.classifications')",
      folderMapping: "batchMove: {category: folder} map; 'default' key as fallback",
    },
    enums: { action: ['read', 'move', 'copy', 'delete', 'markRead', 'batchMove', 'listFolders'] },
    conditionalRequired: [
      { whenField: 'action', equals: 'move', require: ['targetFolder', 'emailUid'] },
      { whenField: 'action', equals: 'copy', require: ['targetFolder', 'emailUid'] },
      { whenField: 'action', equals: 'delete', require: ['uidToDelete'] },
      { whenField: 'action', equals: 'batchMove', require: ['batchSource', 'folderMapping'] },
      { whenField: 'action', equals: 'markRead', requireAnyOf: [['emailUid', 'uidToMark']] },
    ],
    sourceHandles: 'default only',
    notes:
      "Credentials live in a WorkflowConnection (provider='imap') — never in node data. The node fails at runtime if the agent has no IMAP connection (set up in Agent Studio). markRead needs emailUid or uidToMark.",
  },

  smtp: {
    nodeType: 'smtp',
    description:
      'Sends a new email or forwards an IMAP-read email via SMTP; result stored in context.smtpResult.',
    requiredFields: ['mode', 'to'],
    optionalFields: {
      connectionId: "WorkflowConnection ID; falls back to the agent's first SMTP connection",
      subject: 'send mode: subject, template vars supported (required in send mode)',
      body: 'send mode: Markdown body converted to styled HTML (required in send mode)',
      fromName: "Sender display name; From address is always the connection's own email",
      addPrefix: "forward mode: subject prefix (default '[FWD]')",
      includeOriginalHeaders: 'forward mode: prepend From/Date/Subject/To block (default true)',
      emailIndex: 'forward mode STANDALONE only: index into imapResult.emails (default 0). Ignored inside a ForEach loop over IMAP mails — the loop item wins',
    },
    enums: { mode: ['forward', 'send'] },
    conditionalRequired: [{ whenField: 'mode', equals: 'send', require: ['subject', 'body'] }],
    sourceHandles: 'default only',
    notes:
      "Credentials in WorkflowConnection (provider='smtp'). Forward mode forwards a mail that a prior IMAP read produced. Exactly ONE candidate applies per situation: INSIDE a ForEach loop it is the CURRENT loop item (forEachContext.currentItem — whatever you named forEachItemVar; context.currentEmail is deliberately NOT consulted inside a loop because the engine leaves that variable behind when a previous loop ends, so a stale mail could outrank the current item). OUTSIDE a loop it is context.currentEmail, and if that is absent, imapResult.emails[emailIndex] (default 0) — only this last step needs imapResult in the context. A candidate counts as a mail only with uid/subject/from/to/date/body; if a candidate EXISTS but is not a mail (e.g. a data-sheet row) the node FAILS instead of falling back, because falling back would silently forward the wrong mail — the same mail on every iteration inside a loop. emailIndex is standalone-only and is never used inside a loop. ⚠️ TOOL-ATTACHMENT MODE IS A DIFFERENT CONTRACT: attached to an AI node (type:'tool', toolType:'smtp') these requiredFields do NOT apply — the engine reads only connectionId and toEmail; mode/subject/body are IGNORED because the AI supplies them, and toEmail PINS the recipient. 🔴 connectionId is REQUIRED here and there is NO agent-level fallback: the 'falls back to the agent's first SMTP connection' behaviour above applies to the ACTION node only. The Agent Studio SMTP panel does not write connectionId onto the node, so an SMTP tool attached in the dashboard commonly ends up with none and silently loads nothing. See the 'AI node tools' section of aitalk://workflow-guide.",
  },

  sendgrid: {
    nodeType: 'sendgrid',
    description:
      'Sends an email via the SendGrid API with Markdown body converted to HTML; result stored in context.sendGridResult.',
    requiredFields: ['toEmail', 'fromEmail', 'subject', 'bodyTemplate'],
    optionalFields: { fromName: 'Sender display name' },
    enums: {},
    sourceHandles: 'default only',
    notes:
      "API key comes from the agent's WorkflowConnection (provider='sendgrid') — errors if missing. toEmail/subject/bodyTemplate support template variables ({{message}}, {{aiResponse}}, {{context.*}}); fromEmail must be a SendGrid-verified sender. ⚠️ TOOL-ATTACHMENT MODE IS A DIFFERENT CONTRACT: attached to an AI node (type:'tool', toolType:'sendgrid') these requiredFields do NOT apply — the engine reads only connectionId, fromEmail, fromName and toEmail; subject and bodyTemplate are IGNORED because the AI supplies them. toEmail on the node ALWAYS wins and pins the recipient (it is removed from the tool schema so the AI cannot change it), but fromEmail/fromName are only FALLBACKS — the connection's serviceConfig values are read first and win. Without connectionId the tool loads nothing, silently. See the 'AI node tools' section of aitalk://workflow-guide.",
  },

  telegram: {
    nodeType: 'telegram',
    description: 'Sends a message via the Telegram Bot API; result stored in context.telegramResult.',
    requiredFields: ['chatId', 'message'],
    optionalFields: {
      parseMode: 'Formatting mode; omitted = plain text',
      disableNotification: 'Silent notification (default false)',
    },
    enums: { parseMode: ['HTML', 'Markdown', 'MarkdownV2'] },
    sourceHandles: 'default only',
    notes:
      "Bot token comes from the agent's WorkflowConnection (provider='telegram') — errors if missing. chatId and message support template variables; personal chats need a numeric chat ID. ⚠️ TOOL-ATTACHMENT MODE IS A DIFFERENT CONTRACT: attached to an AI node (type:'tool', toolType:'telegram') these requiredFields do NOT apply — the engine reads only connectionId and chatId; message is IGNORED because the AI supplies it. The resolved chatId pins the destination against anything the AI passes, BUT the node's chatId is only a FALLBACK: the connection's serviceConfig.chatId is read first and wins, so writing chatId on the node does not reliably change where the message goes. Without connectionId the tool loads nothing, silently. See the 'AI node tools' section of aitalk://workflow-guide.",
  },

  sms_infobip: {
    nodeType: 'sms_infobip',
    description:
      'Sends a one-way SMS via Infobip; result stored in context.smsResult. The recommended SMS node.',
    requiredFields: ['recipient', 'message'],
    optionalFields: {},
    enums: {},
    sourceHandles: 'default only',
    notes:
      "Recipient must resolve to E.164 format (e.g. +41...) after template substitution or the node errors. Credentials come from the agent's WorkflowConnection (provider='infobip_sms') — API key plus the account-specific base URL and the sender; there are no node-level credential fields. The sender may be an alphanumeric brand name (e.g. \"AiTalk ch\") where the destination country allows it (Switzerland does, without pre-registration; the US, Canada and South Korea do not) or a phone number owned in the account. IMPORTANT: context.smsResult.success means the provider ACCEPTED the message, not that it reached the handset — the send API answers while the message is still PENDING, and a later carrier rejection (e.g. an alphanumeric sender in a country that forbids it) is not reflected back. Treat success as 'accepted for delivery'. ⚠️ TOOL-ATTACHMENT MODE IS A DIFFERENT CONTRACT: attached to an AI node these requiredFields do NOT apply — the engine reads only connectionId and recipient; message is IGNORED because the AI supplies it on every call. `recipient` IS the node-level destination pin (since 2026-08-06, same role as sendgrid/smtp toEmail): set it and `to` is removed from the tool schema, and the pin beats both the model's `to` and the PSTN caller-number fallback. It is NOT template-substituted in tool mode (no context at tool-init time) and a non-E.164 pin is rejected rather than falling back. Leave it empty for the old free mode — the model then chooses the recipient on every call, with a PSTN-only fallback to the live call's verified caller number (no fallback on chat/web voice), so treat the destination as attacker-influencable if untrusted text can reach the context. Agent Studio always stamps AI-tool SMS nodes with toolType:'sms' regardless of provider — the actual provider is resolved from connectionId. Without connectionId the tool loads nothing, silently. See the 'AI node tools' section of aitalk://workflow-guide.",
  },

  sms_acs: {
    nodeType: 'sms_acs',
    description:
      'Sends a one-way SMS via Azure Communication Services Alphanumeric Sender ID; result stored in context.smsResult. NOT USABLE on the current subscription — prefer sms_infobip.',
    requiredFields: ['recipient', 'message'],
    optionalFields: {},
    enums: {},
    sourceHandles: 'default only',
    notes:
      "Recipient must resolve to E.164 format (e.g. +41...) after template substitution or the node errors. ACS connection (provider='acs_sms') is resolved per agent (no node-level credential fields). WARNING: sending is currently impossible on this account — every sender returns 401 because Alphanumeric Sender ID is blocked for individual-tier Azure subscriptions. This node is hidden from the palette; use sms_infobip.",
  },

  sms: {
    nodeType: 'sms',
    description:
      'DEPRECATED alias of sms_acs (pre-2026-08-04 workflows). Use sms_infobip for new work.',
    requiredFields: ['recipient', 'message'],
    optionalFields: {},
    enums: {},
    sourceHandles: 'default only',
    notes:
      'Kept so existing workflows keep validating and running; routed to the ACS provider. Do not author new nodes with this type.',
  },

  httpRequest: {
    nodeType: 'httpRequest',
    description:
      'Generic HTTP client — one call (single mode) or multiple sequential calls (multi mode) with auth, template variables and JSON auto-parsing; result in context.httpResult.',
    requiredFields: [],
    optionalFields: {
      mode: "Execution mode, default 'single'",
      url: 'single mode: request URL (required at runtime)',
      method: "single mode HTTP method, default 'GET'",
      baseUrl: 'multi mode: base URL (required at runtime)',
      requests: 'multi mode: [{alias, method, path, enabled, body?, signed?}] — at least one enabled entry required; each result stored under context.httpResult.<alias>. Every ENABLED entry needs a non-empty alias, aliases must be UNIQUE within the node, and an alias may not contain "." (the template path separator) or "}" (the template terminator) and may not be a prototype name (__proto__/prototype/constructor) — all rejected on deploy, because otherwise a later request silently overwrites an earlier result (or the result cannot be read back) and the success count is undercounted',
      requestDelay: 'multi mode: delay in ms between requests (default 0)',
      preset: "UI autofill preset ('trading212'/'newsapi'/'binance-public'/'binance-private'/'direct') — not read by the executor",
      environment: 'UI-only preset environment (e.g. demo/live)',
      httpConnectionId: "WorkflowConnection label (provider 'http_request') — encrypted credentials merged over node data",
      authType: "Auth scheme, default 'none' — 'hmac' requires mode 'multi'; in single mode it is rejected on deploy and the executor fails the node at runtime",
      authHeaderName: "apiKey mode header name, default 'Authorization'",
      authHeaderValue: 'apiKey mode header value',
      bearerToken: 'bearer mode token',
      basicUser: 'basic mode username',
      basicPassword: 'basic mode password',
      hmacApiKey: 'hmac mode API key (X-MBX-APIKEY) — MULTI mode only; single + hmac is refused (deploy validation + runtime) because the executor attaches no header there',
      hmacSecret: 'hmac mode signing secret (Binance-style query signing) — MULTI mode only; applied per request via requests[].signed',
      headers: 'Custom headers [{key, value}], template-substituted',
      bodyType: "single mode body type, default 'none'; 'json' auto-sets Content-Type",
      body: 'single mode body for POST/PUT/PATCH',
      timeout: 'Per-request timeout in seconds (default 30)',
    },
    enums: {
      mode: ['single', 'multi'],
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      authType: ['none', 'apiKey', 'bearer', 'basic', 'hmac'],
      bodyType: ['json', 'text', 'none'],
    },
    clampedEnums: ['mode'],
    conditionalRequired: [
      { whenField: 'mode', equals: 'single', require: ['url'], defaultsTo: true },
      { whenField: 'mode', equals: 'multi', require: ['baseUrl', 'requests'], requireArray: [{ field: 'requests', someTruthyKey: 'enabled' }] },
    ],
    sourceHandles: 'default only',
    notes:
      'HTTP 4xx/5xx still counts as node success in single mode (branch on it with If/Else); multi mode fails only if all requests fail. Credentials may live in an encrypted WorkflowConnection which overrides plaintext node fields.',
  },

  dataSheets: {
    nodeType: 'dataSheets',
    description:
      'CRUD against the built-in Data Sheets storage with schema validation and {{variable}} substitution; result in context.dataSheetsResult (and under saveAs if set).',
    requiredFields: ['sheetId', 'operation'],
    optionalFields: {
      filter: 'Field-value match object for read/update/delete/upsert/increment (exact equality)',
      data: 'Row object for insert/update/upsert; array or template object for batch-insert; for increment, the AMOUNT TO ADD per field (e.g. {"points": 10})',
      batchData: 'Explicit rows array for batch-insert (takes precedence over data)',
      limit: 'Max rows for read (default 100)',
      saveAs: 'Context variable name for the result (read: 0→null, 1→object, N→array)',
      outputVariable: 'Seen in some legacy templates but NOT read by the executor — results only save under saveAs; this key is ignored',
    },
    enums: { operation: ['read', 'insert', 'update', 'delete', 'upsert', 'batch-insert', 'increment'] },
    conditionalRequired: [
      { whenField: 'operation', equals: 'insert', require: ['data'] },
      { whenField: 'operation', equals: 'update', require: ['filter', 'data'] },
      { whenField: 'operation', equals: 'delete', require: ['filter'] },
      { whenField: 'operation', equals: 'upsert', require: ['data'] },
      { whenField: 'operation', equals: 'batch-insert', requireAnyOf: [['batchData', 'data']] },
      { whenField: 'operation', equals: 'increment', require: ['filter', 'data'] },
    ],
    sourceHandles: 'default only',
    notes:
      'sheetId is the DataSheet DB record ID — sheets are created in the Data Sheets UI, not by this node (a template copied with sheetId:null must have a sheet attached before deploy). Rows are validated against the sheet column schema; 50MB per-sheet limit. ' +
      'INCREMENT adds to numbers instead of replacing them: data is the AMOUNT to add per field, so {"points": 10} means points += 10. ' +
      'Use it for anything that accumulates (points, credits, counters) — there is NO arithmetic anywhere else in the workflow language ' +
      '(conditions exclude it, templates are string substitution), so the alternative is to have the model read the value, do the sum and write it back. ' +
      'Do not do that: the model would own the number, and the gap between the read and the write loses concurrent updates. ' +
      'increment runs the read-modify-write inside one transaction that locks the sheet, so two increments on the same sheet queue instead of overwriting each other. ' +
      'That guarantee covers increment against increment ONLY — insert, update, delete and batch-insert do not take the lock, so an increment racing one of those can still be overwritten; do not describe it to the owner as generally atomic. ' +
      'Rules: filter is required and an EMPTY filter is refused (it would match every row); each amount must be a number (a decimal numeric string is accepted since templates produce strings); ' +
      'the target must be a declared "number" column of the sheet — incrementing an unknown column or a string/date column is refused, so a typo fails loudly instead of creating a hidden field; ' +
      'a field that is missing, null or "" starts from 0; a field holding a non-numeric value is refused rather than reset; a sum that overflows to Infinity is refused (JSON would store it as null and the next increment would restart from 0); ' +
      'and "id", "createdAt" and "updatedAt" are refused because they are the row\'s own fields, not data. ' +
      'Values are ordinary JSON numbers (IEEE-754 doubles), so a balance beyond 2^53 or a fractional amount rounds the way JavaScript rounds — keep counters to whole numbers in a sane range. ' +
      'The result carries the UPDATED rows (result.rows) plus updatedCount/rowCount, so read the new balance from there instead of issuing a second read — that second read is itself a race.',
  },

  store: {
    nodeType: 'store',
    description:
      "Writes text content into the user's RAG store (OpenAI Vector Store / Pinecone / Gemini / Azure AI Search) with auto document ID and chunking; result in context.storeResult.",
    requiredFields: ['content'],
    optionalFields: {
      documentIdMode: "Document ID generation, default 'auto'",
      documentIdTemplate: "Template for documentIdMode='template' (supports {{variables}})",
      customMetadata: 'Array of {key, value} merged into document metadata',
      ragSpaceId: "Azure AI Search only: target RAG space; invalid → agent's Default space",
    },
    enums: { documentIdMode: ['auto', 'template'] },
    sourceHandles: 'default only',
    notes:
      "RAG provider comes from context (prior Source node) or the account's settings — not from node data. Errors at runtime if no RAG provider is configured.",
  },

  pstn: {
    nodeType: 'pstn',
    description:
      'Outbound-only phone call node — places a PSTN call via ACS Call Automation and creates a CallSession; result in context.pstnResult. WITHDRAWN — hidden from the palette and not to be authored; see notes.',
    requiredFields: ['targetPhoneNumber'],
    optionalFields: {
      greeting: 'NOT WIRED — stored on the node and echoed in the execution log only',
      language: "STT/TTS language on the CallSession (default 'de-CH')",
      voiceName: 'TTS voice name on the CallSession',
    },
    enums: {},
    sourceHandles: 'default only',
    notes:
      "DO NOT AUTHOR NEW NODES OF THIS TYPE. Withdrawn 2026-08-04 by the owner: unattended outbound dialling invites cold-call abuse (loading a purchased list and mass-dialling), which outweighs its use. Hidden from the Agent Studio palette; existing nodes still load and run so old workflows keep working. It is also incomplete — greeting/callScript/maxDurationMinutes are never read at runtime, and the node omits workflowId/startNodeId from the media-streaming URL, so the AI side of the call is resolved from whichever production workflow of the agent was updated last, not from this node. INCOMING calls are NOT this node — they are the start node with triggerType='pstn', which remains fully supported.",
  },

  note: {
    nodeType: 'note',
    description: 'Canvas-only sticky-note annotation — never executes, has no edges.',
    requiredFields: [],
    optionalFields: {
      noteText: "Note body text (default '')",
      backgroundColor: "Background color (default '#fef3c7')",
      width: 'Width in px (default 200)',
      height: 'Height in px (default 150)',
    },
    enums: {},
    sourceHandles: 'none — the note component renders no handles',
    notes: 'Purely visual documentation on the canvas; the engine has no note case and ignores it.',
  },

  webhook: {
    nodeType: 'webhook',
    description: 'NOT EXECUTABLE — stub. The engine logs "not yet implemented" and passes context through unchanged.',
    requiredFields: [],
    optionalFields: {},
    enums: {},
    sourceHandles: 'default only',
    notes: 'Do not use. Present in the type union but executeNodeByType only logs a stub message.',
    notExecutable: true,
  },
}
