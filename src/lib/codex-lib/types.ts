
export interface UserRequestAnalysis {
  keywords: string[];
  nodeTypes: string[];
  features: string[];
  intent: 'create' | 'modify' | 'add';
  complexity: 'simple' | 'medium' | 'complex';
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  nodeTypes: string[];
  features: string[];
  example: {
    nodes: any[];
    edges: any[];
  };
  explanation: string;
}

export interface JsonSchemaExample {
  id: string;
  name: string;
  description: string;
  schema: any;
  useCase: string;
}

export interface CodexPromptContext {
  baseGuide: string;
  relevantTemplates: WorkflowTemplate[];
  relevantSchemas: JsonSchemaExample[];
  userRequest: string;
  existingWorkflow?: {
    nodes: any[];
    edges: any[];
  };
}
