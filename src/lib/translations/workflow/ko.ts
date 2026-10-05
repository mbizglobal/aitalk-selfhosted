// Workflow Korean translations
export const translations = {
  ko: {
    // JSON Schema errors
    json_schema_error_title: 'JSON 스키마 오류',
    json_schema_missing_required: "'{context}' 객체에서 '{field}' 속성이 'required' 배열에 누락되었습니다.",
    json_schema_missing_required_hint: "OpenAI API는 모든 properties의 키가 'required' 배열에 포함되어야 합니다.",
    json_schema_additional_properties_required: "JSON 스키마에 'additionalProperties: false'가 필요합니다.",
    json_schema_additional_properties_hint: "OpenAI API는 모든 object 타입에 'additionalProperties: false'를 요구합니다. AI 노드의 JSON Schema를 수정해주세요.",
    json_schema_invalid: '유효하지 않은 JSON 스키마 형식입니다.',
    json_schema_parse_error: 'JSON 스키마 파싱에 실패했습니다.',

    // API errors
    api_key_not_configured: 'API 키가 설정되지 않았습니다. 설정에서 API 키를 설정해주세요.',
    api_request_failed: 'API 요청이 실패했습니다.',
    api_rate_limit: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
    api_quota_exceeded: 'API 사용량을 초과했습니다. 결제 설정을 확인해주세요.',

    // Workflow execution errors
    workflow_not_found: '워크플로우를 찾을 수 없습니다.',
    workflow_execution_failed: '워크플로우 실행에 실패했습니다.',
    node_execution_failed: '노드 실행에 실패했습니다.',
    invalid_node_type: '유효하지 않은 노드 타입입니다.',

    // MCP errors
    mcp_connection_failed: 'MCP 연결에 실패했습니다.',
    mcp_tool_call_failed: 'MCP 도구 호출에 실패했습니다.',
    mcp_server_url_not_configured: 'MCP 서버 URL이 설정되지 않았습니다.',

    // File errors
    file_upload_failed: '파일 업로드에 실패했습니다.',
    file_too_large: '파일 크기가 최대 한도를 초과했습니다.',
    unsupported_file_type: '지원하지 않는 파일 형식입니다.',

    // General errors
    unknown_error: '알 수 없는 오류가 발생했습니다.',
    network_error: '네트워크 오류입니다. 연결 상태를 확인해주세요.',
    timeout_error: '요청 시간이 초과되었습니다. 다시 시도해주세요.',
  }
}
