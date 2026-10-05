// Workflow French translations
export const translations = {
  fr: {
    // JSON Schema errors
    json_schema_error_title: 'Erreur de schéma JSON',
    json_schema_missing_required: "Dans l'objet '{context}', la propriété '{field}' est absente du tableau 'required'.",
    json_schema_missing_required_hint: "L'API OpenAI exige que toutes les propriétés soient listées dans le tableau 'required'.",
    json_schema_additional_properties_required: "Le schéma JSON nécessite 'additionalProperties: false'.",
    json_schema_additional_properties_hint: "L'API OpenAI exige 'additionalProperties: false' pour tous les types d'objets. Veuillez mettre à jour le schéma JSON dans votre nœud AI.",
    json_schema_invalid: 'Format de schéma JSON invalide.',
    json_schema_parse_error: "Échec de l'analyse du schéma JSON.",

    // API errors
    api_key_not_configured: "La clé API n'est pas configurée. Veuillez configurer votre clé API dans les paramètres.",
    api_request_failed: "La requête API a échoué.",
    api_rate_limit: 'Limite de requêtes API dépassée. Veuillez réessayer plus tard.',
    api_quota_exceeded: 'Quota API dépassé. Veuillez vérifier vos paramètres de facturation.',

    // Workflow execution errors
    workflow_not_found: 'Workflow introuvable.',
    workflow_execution_failed: "L'exécution du workflow a échoué.",
    node_execution_failed: "L'exécution du nœud a échoué.",
    invalid_node_type: 'Type de nœud invalide.',

    // MCP errors
    mcp_connection_failed: 'La connexion MCP a échoué.',
    mcp_tool_call_failed: "L'appel d'outil MCP a échoué.",
    mcp_server_url_not_configured: "L'URL du serveur MCP n'est pas configurée.",

    // File errors
    file_upload_failed: 'Le téléchargement du fichier a échoué.',
    file_too_large: 'La taille du fichier dépasse la limite maximale.',
    unsupported_file_type: 'Type de fichier non pris en charge.',

    // General errors
    unknown_error: 'Une erreur inconnue est survenue.',
    network_error: 'Erreur réseau. Veuillez vérifier votre connexion.',
    timeout_error: 'Délai de requête dépassé. Veuillez réessayer.',
  }
}
