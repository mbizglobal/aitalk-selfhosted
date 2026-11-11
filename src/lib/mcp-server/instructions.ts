export function serverInstructions(selfHosted: boolean): string {
  return (
    'AiTalk MCP server. Hierarchy: account → agents → workflows. Read: list_agents → list_workflows(agentId) → get_workflow(workflowId). ' +
    'Authoring (write scope) — full chain: create_workflow (from a template via list_workflow_templates, or blank; always created as draft) → ' +
    'edit with patch_workflow_params (typed template parameters — the safe, preferred path) or update_workflow (replace the entire node graph; read aitalk://node-catalog first) → ' +
    'validate_workflow → deploy_workflow (takes it live for real customers immediately — confirm with the owner first). ' +
    'undeploy_workflow switches a live workflow back to draft; it stops taking NEW chats and calls at once (a call already connected finishes normally), so ask the owner first too. ' +
    'request_workflow_deploy is the alternative to deploy_workflow: it returns a confirmationUrl the owner opens and clicks Deploy on themselves — use it when they want to review what goes live. ' +
    'Both editors take expectedVersion (optimistic concurrency) and dryRun. Editing a live (production) workflow reaches customers immediately — confirm with the owner first; archived workflows are rejected. ' +
    'Workflows and agents cannot be deleted over MCP, and there is no test-run tool — use the dashboard for both. ' +
    'Sub-workflows (kind "sub") are workflows the AI calls as a function instead of channel-triggered ones: create with create_workflow({kind:"sub"}) — no template, never deployed, and its Start node defines the tool the caller sees. Read the "Sub-workflows" section of aitalk://workflow-guide first. ' +
    'Read the aitalk://workflow-guide resource before using write tools. ' +
    'Assembled work apps (a team work app built from ready-made blocks — no code): list_work_blocks / get_work_app_spec / validate_work_app_spec / create_work_app / update_work_app_spec — read aitalk://work-app-guide first. Changing an app that already has rows returns a confirmationUrl for the owner instead of applying. ' +
    (selfHosted
      ? 'AI node tools (SendGrid/Telegram/SMTP/MCP/web search attached to an AI node): the node catalog documents the ACTION-node contract, which does NOT apply to tool attachments — read the "AI node tools" section of aitalk://workflow-guide first. ' +
        'The sendgrid/telegram/smtp tool types need data.connectionId (MCP needs data.mcpConnectionId; workInbox needs data.targetWorkflowId + data.inboxFamily; webSearch, source, functionCalling and workApp need none), and connection ids are NOT discoverable over MCP: reuse one already visible in a get_workflow response for that agent, or ask the owner to create the connection in Agent Studio. Saving one without it deploys fine and then silently does nothing at run time. '
      : 'AI node tools (SendGrid/Telegram/SMS/SMTP/MCP/web search attached to an AI node): the node catalog documents the ACTION-node contract, which does NOT apply to tool attachments — read the "AI node tools" section of aitalk://workflow-guide first. ' +
        'The sendgrid/telegram/sms/smtp/calendar tool types need data.connectionId (MCP needs data.mcpConnectionId; workInbox needs data.targetWorkflowId + data.inboxFamily; webSearch, source, functionCalling and workApp need none), and connection ids are NOT discoverable over MCP: reuse one already visible in a get_workflow response for that agent, or ask the owner to create the connection in Agent Studio. Saving one without it deploys fine and then silently does nothing at run time. ') +
    'Knowledge base (RAG) source files: list_source_files / get_source_file / create_source_text / delete_source_file. ' +
    'get_source_file returns the document text (contentSource "stored" = as submitted; "indexed_chunks" = the extracted text the AI searches, which is what dashboard-uploaded PDF/DOCX files give you — no layout or images). ' +
    'There is no in-place update: to correct a document, read it, then delete_source_file + create_source_text with the fixed text (a corrected binary comes back as .txt and the original file is gone). ' +
    'Indexing is asynchronous — after create_source_text, poll get_source_file until status is "completed" (or "failed" — stop then and read errorMessage). ' +
    'IMPORTANT: binary files (PDF/DOCX/PPTX/XLSX/images) cannot be transferred over MCP — convert or extract them to plain text/markdown locally in your environment first and pass the text to create_source_text, or direct the user to the dashboard Storage page. ' +
    'Conversation history (read-only): list_conversations / get_conversation — text chats, voice calls and quiz attempts. ' +
    'This is the owner\'s customer data (caller phone numbers, conversation content) — use it only for what the owner asked; never send it to third parties.'
  )
}
