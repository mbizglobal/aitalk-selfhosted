import { WorkflowTemplate } from '../types';

export const textGenerationTemplate: WorkflowTemplate = {
  id: 'text-generation',
  name: 'Text Generation Workflow',
  description: 'Generate natural language text responses (email, summary, explanation)',
  keywords: ['텍스트', 'text', '생성', 'generate', '이메일', 'email', '요약', 'summary', '설명', 'explain', '답변', 'response'],
  nodeTypes: ['start', 'ai', 'end'],
  features: ['text-output', 'natural-language'],

  example: {
    nodes: [
      {
        id: '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
        type: 'custom',
        position: { x: 100, y: 300 },
        data: {
          label: 'Start',
          icon: null,
          color: 'bg-blue-500',
          showLeftHandle: false,
          nodeType: 'start'
        }
      },
      {
        id: '2b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e',
        type: 'custom',
        position: { x: 400, y: 300 },
        data: {
          label: 'Generate Email',
          icon: null,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          systemMessage: 'You are a professional email writer. Generate a polite and concise email based on the user input. Use proper business email format with greeting, body, and closing.',
          model: 'gpt-4.1-mini',
          temperature: 0.7,
          maxTokens: 2048,
          outputFormat: 'text',
          imageInput: false,
          pdfInput: false,
          includeChatHistory: true
        }
      },
      {
        id: '3c4d5e6f-7a8b-4c3d-0e1f-2a3b4c5d6e7f',
        type: 'custom',
        position: { x: 700, y: 300 },
        data: {
          label: 'End',
          icon: null,
          color: 'bg-green-500',
          nodeType: 'end'
        }
      }
    ],
    edges: [
      {
        id: 'edge-1-2',
        source: '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
        target: '2b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      },
      {
        id: 'edge-2-3',
        source: '2b3c4d5e-6f7a-4b2c-9d0e-1f2a3b4c5d6e',
        target: '3c4d5e6f-7a8b-4c3d-0e1f-2a3b4c5d6e7f',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      }
    ]
  },

  explanation: `
This workflow demonstrates TEXT output mode:
1. outputFormat: "text" (NOT "json")
2. NO jsonSchema or schemaName needed
3. Higher temperature (0.7) for creative writing
4. Use cases: email, summary, explanation, conversation
5. systemMessage guides the style and format
  `.trim()
};
