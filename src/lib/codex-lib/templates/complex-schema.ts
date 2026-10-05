import { WorkflowTemplate } from '../types';

export const complexSchemaTemplate: WorkflowTemplate = {
  id: 'complex-schema',
  name: 'Complex JSON Schema Example',
  description: 'Showcase all JSON Schema types: String, Number, Boolean, Enum, Array, Object',
  keywords: ['복잡한', 'complex', '스키마', 'schema', '다양한', 'various', 'types', 'array', 'object', 'enum'],
  nodeTypes: ['start', 'ai', 'end'],
  features: ['json-output', 'structured-output', 'complex-schema'],

  example: {
    nodes: [
      {
        id: '4d5e6f7a-8b9c-4d4e-1f2a-3b4c5d6e7f8a',
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
        id: '5e6f7a8b-9c0d-4e5f-2a3b-4c5d6e7f8a9b',
        type: 'custom',
        position: { x: 400, y: 300 },
        data: {
          label: 'Extract Complex Data',
          icon: null,
          color: 'bg-blue-500',
          nodeType: 'ai',
          showTools: true,
          toolCount: 0,
          systemMessage: 'Extract detailed product information from the input. Include all fields in the schema with accurate data types.',
          model: 'gpt-6-luna',
          temperature: 0.1,
          maxTokens: 2048,
          outputFormat: 'json',
          schemaName: 'product_details_schema',
          jsonSchema: {
            type: 'object',
            properties: {
              // String type
              productName: {
                type: 'string',
                description: 'Name of the product'
              },

              // Number types
              price: {
                type: 'number',
                description: 'Product price as decimal number'
              },
              stockQuantity: {
                type: 'integer',
                description: 'Number of items in stock (whole number)'
              },

              // Boolean type
              inStock: {
                type: 'boolean',
                description: 'Whether the product is currently available'
              },

              // Enum type (limited choices)
              category: {
                type: 'string',
                enum: ['Electronics', 'Clothing', 'Food', 'Books', 'Other'],
                description: 'Product category from predefined list'
              },

              // Array of strings
              tags: {
                type: 'array',
                description: 'Product tags or keywords',
                items: {
                  type: 'string'
                }
              },

              // Array of objects (complex nested structure)
              reviews: {
                type: 'array',
                description: 'Customer reviews',
                items: {
                  type: 'object',
                  properties: {
                    reviewer: {
                      type: 'string',
                      description: 'Name of the reviewer'
                    },
                    rating: {
                      type: 'integer',
                      description: 'Rating from 1 to 5'
                    },
                    comment: {
                      type: 'string',
                      description: 'Review comment'
                    },
                    verified: {
                      type: 'boolean',
                      description: 'Whether purchase is verified'
                    }
                  },
                  required: ['reviewer', 'rating']
                }
              },

              // Nested object
              manufacturer: {
                type: 'object',
                description: 'Manufacturer information',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Manufacturer name'
                  },
                  country: {
                    type: 'string',
                    description: 'Country of origin'
                  },
                  website: {
                    type: 'string',
                    description: 'Company website URL'
                  }
                },
                required: ['name']
              },

              // Optional field (not in required array)
              warranty: {
                type: 'string',
                description: 'Warranty information if available'
              }
            },
            required: [
              'productName',
              'price',
              'stockQuantity',
              'inStock',
              'category',
              'tags'
            ]
          },
          imageInput: false,
          pdfInput: false,
          includeChatHistory: true
        }
      },
      {
        id: '6f7a8b9c-0d1e-4f6a-3b4c-5d6e7f8a9b0c',
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
        source: '4d5e6f7a-8b9c-4d4e-1f2a-3b4c5d6e7f8a',
        target: '5e6f7a8b-9c0d-4e5f-2a3b-4c5d6e7f8a9b',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      },
      {
        id: 'edge-2-3',
        source: '5e6f7a8b-9c0d-4e5f-2a3b-4c5d6e7f8a9b',
        target: '6f7a8b9c-0d1e-4f6a-3b4c-5d6e7f8a9b0c',
        type: 'default',
        style: { stroke: '#666', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#666' }
      }
    ]
  },

  explanation: `
This workflow demonstrates ALL JSON Schema types:
1. String: productName, warranty
2. Number: price (decimal), stockQuantity (integer)
3. Boolean: inStock, verified
4. Enum: category (limited choices)
5. Array of strings: tags
6. Array of objects: reviews (nested structure)
7. Nested object: manufacturer
8. Required vs optional fields
9. Complete descriptions for all fields
  `.trim()
};
