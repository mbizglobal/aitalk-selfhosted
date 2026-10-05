// Workflow Spanish translations
export const translations = {
  es: {
    // JSON Schema errors
    json_schema_error_title: 'Error de esquema JSON',
    json_schema_missing_required: "En el objeto '{context}', falta la propiedad '{field}' en el array 'required'.",
    json_schema_missing_required_hint: "La API de OpenAI requiere que todas las propiedades estén listadas en el array 'required'.",
    json_schema_additional_properties_required: "El esquema JSON requiere 'additionalProperties: false'.",
    json_schema_additional_properties_hint: "La API de OpenAI requiere 'additionalProperties: false' para todos los tipos de objetos. Por favor, actualice el esquema JSON en su nodo AI.",
    json_schema_invalid: 'Formato de esquema JSON inválido.',
    json_schema_parse_error: 'Error al analizar el esquema JSON.',

    // API errors
    api_key_not_configured: 'La clave API no está configurada. Por favor, configure su clave API en Configuración.',
    api_request_failed: 'La solicitud de API falló.',
    api_rate_limit: 'Límite de solicitudes de API excedido. Por favor, inténtelo de nuevo más tarde.',
    api_quota_exceeded: 'Cuota de API excedida. Por favor, verifique su configuración de facturación.',

    // Workflow execution errors
    workflow_not_found: 'Flujo de trabajo no encontrado.',
    workflow_execution_failed: 'La ejecución del flujo de trabajo falló.',
    node_execution_failed: 'La ejecución del nodo falló.',
    invalid_node_type: 'Tipo de nodo inválido.',

    // MCP errors
    mcp_connection_failed: 'La conexión MCP falló.',
    mcp_tool_call_failed: 'La llamada de herramienta MCP falló.',
    mcp_server_url_not_configured: 'La URL del servidor MCP no está configurada.',

    // File errors
    file_upload_failed: 'La carga del archivo falló.',
    file_too_large: 'El tamaño del archivo excede el límite máximo.',
    unsupported_file_type: 'Tipo de archivo no compatible.',

    // General errors
    unknown_error: 'Ocurrió un error desconocido.',
    network_error: 'Error de red. Por favor, verifique su conexión.',
    timeout_error: 'Tiempo de solicitud agotado. Por favor, inténtelo de nuevo.',
  }
}
