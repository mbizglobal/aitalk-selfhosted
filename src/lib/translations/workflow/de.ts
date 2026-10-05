// Workflow German translations
export const translations = {
  de: {
    // JSON Schema errors
    json_schema_error_title: 'JSON-Schema-Fehler',
    json_schema_missing_required: "Im '{context}'-Objekt fehlt die Eigenschaft '{field}' im 'required'-Array.",
    json_schema_missing_required_hint: "Die OpenAI-API erfordert, dass alle Eigenschaften im 'required'-Array aufgelistet sind.",
    json_schema_additional_properties_required: "Das JSON-Schema erfordert 'additionalProperties: false'.",
    json_schema_additional_properties_hint: "Die OpenAI-API erfordert 'additionalProperties: false' für alle Objekttypen. Bitte aktualisieren Sie das JSON-Schema in Ihrem AI-Knoten.",
    json_schema_invalid: 'Ungültiges JSON-Schema-Format.',
    json_schema_parse_error: 'JSON-Schema konnte nicht analysiert werden.',

    // API errors
    api_key_not_configured: 'API-Schlüssel ist nicht konfiguriert. Bitte richten Sie Ihren API-Schlüssel in den Einstellungen ein.',
    api_request_failed: 'API-Anfrage fehlgeschlagen.',
    api_rate_limit: 'API-Ratenlimit überschritten. Bitte versuchen Sie es später erneut.',
    api_quota_exceeded: 'API-Kontingent überschritten. Bitte überprüfen Sie Ihre Abrechnungseinstellungen.',

    // Workflow execution errors
    workflow_not_found: 'Workflow nicht gefunden.',
    workflow_execution_failed: 'Workflow-Ausführung fehlgeschlagen.',
    node_execution_failed: 'Knotenausführung fehlgeschlagen.',
    invalid_node_type: 'Ungültiger Knotentyp.',

    // MCP errors
    mcp_connection_failed: 'MCP-Verbindung fehlgeschlagen.',
    mcp_tool_call_failed: 'MCP-Werkzeugaufruf fehlgeschlagen.',
    mcp_server_url_not_configured: 'MCP-Server-URL ist nicht konfiguriert.',

    // File errors
    file_upload_failed: 'Datei-Upload fehlgeschlagen.',
    file_too_large: 'Dateigröße überschreitet das Maximum.',
    unsupported_file_type: 'Nicht unterstützter Dateityp.',

    // General errors
    unknown_error: 'Ein unbekannter Fehler ist aufgetreten.',
    network_error: 'Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.',
    timeout_error: 'Zeitüberschreitung der Anfrage. Bitte versuchen Sie es erneut.',
  }
}
