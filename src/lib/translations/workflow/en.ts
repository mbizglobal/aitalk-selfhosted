// Workflow English translations
export const translations = {
  en: {
    // JSON Schema errors
    json_schema_error_title: 'JSON Schema Error',
    json_schema_missing_required: "In the '{context}' object, the '{field}' property is missing from the 'required' array.",
    json_schema_missing_required_hint: "OpenAI API requires all properties to be listed in the 'required' array.",
    json_schema_additional_properties_required: "JSON schema requires 'additionalProperties: false'.",
    json_schema_additional_properties_hint: "OpenAI API requires 'additionalProperties: false' for all object types. Please update the JSON Schema in your AI node.",
    json_schema_invalid: 'Invalid JSON schema format.',
    json_schema_parse_error: 'Failed to parse JSON schema.',

    // API errors
    api_key_not_configured: 'API key is not configured. Please set up your API key in Settings.',
    api_request_failed: 'API request failed.',
    api_rate_limit: 'API rate limit exceeded. Please try again later.',
    api_quota_exceeded: 'API quota exceeded. Please check your billing settings.',

    // Workflow execution errors
    workflow_not_found: 'Workflow not found.',
    workflow_execution_failed: 'Workflow execution failed.',
    node_execution_failed: 'Node execution failed.',
    invalid_node_type: 'Invalid node type.',

    // MCP errors
    mcp_connection_failed: 'MCP connection failed.',
    mcp_tool_call_failed: 'MCP tool call failed.',
    mcp_server_url_not_configured: 'MCP server URL is not configured.',

    // File errors
    file_upload_failed: 'File upload failed.',
    file_too_large: 'File size exceeds the maximum limit.',
    unsupported_file_type: 'Unsupported file type.',

    // General errors
    unknown_error: 'An unknown error occurred.',
    network_error: 'Network error. Please check your connection.',
    timeout_error: 'Request timed out. Please try again.',
  }
}
