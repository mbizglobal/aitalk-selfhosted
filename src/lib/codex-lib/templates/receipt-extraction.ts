import { WorkflowTemplate } from '../types';

export const receiptExtractionTemplate: WorkflowTemplate = {
  id: 'receipt-extraction',
  name: 'Receipt Data Extraction',
  description: 'Extract structured data from receipt images using vision + JSON output',
  keywords: ['영수증', 'receipt', '이미지', 'image', '추출', 'extract', 'JSON', '날짜', 'date', '금액', 'amount'],
  nodeTypes: ['start', 'ai', 'end'],
  features: ['vision', 'imageInput', 'json-output', 'structured-output'],

  example: {
    nodes: [
      {
        id: '357e75ee-a120-4e55-b53f-49472795ef17',
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
        id: '6714b8ca-98f6-40ef-9697-b33f5810c266',
        type: 'custom',
        position: { x: 400, y: 300 },
        data: {
          label: 'Extract Receipt Data',
          icon: null,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          systemMessage: 'Extract the purchase date, total amount, and list of line items from the provided receipt image. Return JSON that follows the supplied schema. Use ISO 8601 format for the date.',
          model: 'gpt-6-luna',
          temperature: 0,
          maxTokens: 2048,
          outputFormat: 'json',
          schemaName: 'receipt_schema',
          jsonSchema: {
            type: 'object',
            properties: {
              date: {
                type: 'string',
                description: 'Purchase date in ISO 8601 YYYY-MM-DD format'
              },
              amount: {
                type: 'number',
                description: 'Total amount on the receipt'
              },
              currency: {
                type: 'string',
                description: 'Currency code (USD, EUR, etc.)'
              },
              merchant: {
                type: 'string',
                description: 'Merchant or store name'
              },
              items: {
                type: 'array',
                description: 'List of purchased items',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    quantity: { type: 'number' },
                    price: { type: 'number' }
                  },
                  required: ['name']
                }
              }
            },
            required: ['date', 'amount', 'items']
          },
          imageInput: true,
          pdfInput: false,
          includeChatHistory: true
        }
      },
      {
        id: '273dd1cd-4e7b-46e0-ab89-80a414788817',
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
        id: 'b00e9a81-0f72-47a1-b59f-21e9123a2b8a',
        source: '357e75ee-a120-4e55-b53f-49472795ef17',
        target: '6714b8ca-98f6-40ef-9697-b33f5810c266',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      },
      {
        id: '17c96a03-7919-4a39-90e6-dfa27a7a23bb',
        source: '6714b8ca-98f6-40ef-9697-b33f5810c266',
        target: '273dd1cd-4e7b-46e0-ab89-80a414788817',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      }
    ]
  },

  explanation: `
This workflow demonstrates:
1. Using imageInput: true for vision capability
2. Setting outputFormat: "json" with complete jsonSchema
3. Proper schemaName for the schema
4. systemMessage in English with clear instructions
5. All nodes properly connected with correct handles
  `.trim()
};
