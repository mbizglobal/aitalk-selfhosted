import { WorkflowTemplate } from '../types';

export const conditionalApprovalTemplate: WorkflowTemplate = {
  id: 'conditional-approval',
  name: 'Conditional Approval Workflow',
  description: 'Branch workflow based on conditions (e.g., amount threshold)',
  keywords: ['조건', 'condition', '승인', 'approval', '분기', 'branch', 'if', '금액', 'amount', '초과', 'exceed'],
  nodeTypes: ['start', 'ai', 'condition', 'end'],
  features: ['condition', 'branching'],

  example: {
    nodes: [
      {
        id: 'a1b2c3d4-e5f6-4a1b-8c9d-0e1f2a3b4c5d',
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
        id: 'b2c3d4e5-f6a7-4b2c-9d0e-1f2a3b4c5d6e',
        type: 'custom',
        position: { x: 400, y: 300 },
        data: {
          label: 'Extract Amount',
          icon: null,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          systemMessage: 'Extract the total amount from the input. Return as JSON with amount field.',
          model: 'gpt-6-luna',
          temperature: 0,
          maxTokens: 2048,
          outputFormat: 'json',
          schemaName: 'amount_schema',
          jsonSchema: {
            type: 'object',
            properties: {
              amount: { type: 'number', description: 'Total amount' }
            },
            required: ['amount']
          },
          imageInput: false,
          pdfInput: false,
          includeChatHistory: true
        }
      },
      {
        id: 'c3d4e5f6-a7b8-4c3d-0e1f-2a3b4c5d6e7f',
        type: 'custom',
        position: { x: 700, y: 300 },
        data: {
          label: 'Check Amount',
          icon: null,
          color: 'bg-yellow-500',
          nodeType: 'condition',
          variable: 'amount',
          operator: '>',
          value: '100000'
        }
      },
      {
        id: 'd4e5f6a7-b8c9-4d4e-1f2a-3b4c5d6e7f8a',
        type: 'custom',
        position: { x: 1000, y: 200 },
        data: {
          label: 'Request Approval',
          icon: null,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          systemMessage: 'Generate an approval request message for high-value transaction.',
          model: 'gpt-6-luna',
          temperature: 0.7,
          maxTokens: 2048,
          outputFormat: 'text',
          imageInput: false,
          pdfInput: false,
          includeChatHistory: true
        }
      },
      {
        id: 'e5f6a7b8-c9d0-4e5f-2a3b-4c5d6e7f8a9b',
        type: 'custom',
        position: { x: 1000, y: 400 },
        data: {
          label: 'Auto-approve',
          icon: null,
          color: 'bg-green-500',
          nodeType: 'end'
        }
      },
      {
        id: 'f6a7b8c9-d0e1-4f6a-3b4c-5d6e7f8a9b0c',
        type: 'custom',
        position: { x: 1300, y: 200 },
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
        source: 'a1b2c3d4-e5f6-4a1b-8c9d-0e1f2a3b4c5d',
        target: 'b2c3d4e5-f6a7-4b2c-9d0e-1f2a3b4c5d6e',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      },
      {
        id: 'edge-2-3',
        source: 'b2c3d4e5-f6a7-4b2c-9d0e-1f2a3b4c5d6e',
        target: 'c3d4e5f6-a7b8-4c3d-0e1f-2a3b4c5d6e7f',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      },
      {
        id: 'edge-3-4-true',
        source: 'c3d4e5f6-a7b8-4c3d-0e1f-2a3b4c5d6e7f',
        target: 'd4e5f6a7-b8c9-4d4e-1f2a-3b4c5d6e7f8a',
        sourceHandle: 'true',
        type: 'default',
        style: { stroke: '#10b981', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#10b981' }
      },
      {
        id: 'edge-3-5-false',
        source: 'c3d4e5f6-a7b8-4c3d-0e1f-2a3b4c5d6e7f',
        target: 'e5f6a7b8-c9d0-4e5f-2a3b-4c5d6e7f8a9b',
        sourceHandle: 'false',
        type: 'default',
        style: { stroke: '#ef4444', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#ef4444' }
      },
      {
        id: 'edge-4-6',
        source: 'd4e5f6a7-b8c9-4d4e-1f2a-3b4c5d6e7f8a',
        target: 'f6a7b8c9-d0e1-4f6a-3b4c-5d6e7f8a9b0c',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      }
    ]
  },

  explanation: `
This workflow demonstrates:
1. ALL nodes use type: "custom" with nodeType in data
2. Condition node branches with sourceHandle: "true"/"false"
3. Multiple end nodes for different paths
4. Vertical spacing for branching (±100px from center)
5. Proper edge styling with colors for different paths
  `.trim()
};
