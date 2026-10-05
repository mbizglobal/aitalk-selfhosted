
export interface SchemaProperty {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object'
  description: string
  required: boolean
  enumValues?: string[]
  properties?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'enum'
    description: string
    required: boolean
    enumValues?: string[]
  }>
  itemsType?: 'string' | 'number' | 'boolean' | 'enum' | 'object'
  itemsEnumValues?: string[]
  itemsProperties?: Array<{
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'enum'
    description: string
    required: boolean
    enumValues?: string[]
  }>
}

export function buildPropertySchema(prop: SchemaProperty): any {
  let propSchema: any = { type: prop.type }

  if (prop.description) {
    propSchema.description = prop.description
  }

  if (prop.type === 'enum' && prop.enumValues && prop.enumValues.length > 0) {
    propSchema.enum = prop.enumValues
    delete propSchema.type
  }

  if (prop.type === 'object' && prop.properties && prop.properties.length > 0) {
    propSchema.properties = {}
    propSchema.required = []
    propSchema.additionalProperties = false

    prop.properties.forEach(nestedProp => {
      if (!nestedProp.name) return
      propSchema.properties[nestedProp.name] = buildPropertySchema(nestedProp as SchemaProperty)
      if (nestedProp.required) propSchema.required.push(nestedProp.name)
    })
  }

  if (prop.type === 'array') {
    propSchema.items = {}
    if (prop.itemsType) {
      if (prop.itemsType === 'enum' && prop.itemsEnumValues) {
        propSchema.items.enum = prop.itemsEnumValues
      } else if (prop.itemsType === 'object' && prop.itemsProperties && prop.itemsProperties.length > 0) {
        propSchema.items.type = 'object'
        propSchema.items.properties = {}
        propSchema.items.required = []
        propSchema.items.additionalProperties = false
        prop.itemsProperties.forEach(itemProp => {
          if (!itemProp.name) return
          propSchema.items.properties[itemProp.name] = buildPropertySchema(itemProp as SchemaProperty)
          if (itemProp.required) propSchema.items.required.push(itemProp.name)
        })
      } else {
        propSchema.items.type = prop.itemsType
      }
    }
  }

  return propSchema
}

export function buildJsonSchemaFromProperties(
  schemaProperties: SchemaProperty[],
  schemaName: string = 'json_schema'
): string {
  const schema: any = {
    name: schemaName,
    schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    }
  }

  if (!schemaProperties || schemaProperties.length === 0) {
    return JSON.stringify(schema, null, 2)
  }

  schemaProperties.forEach(prop => {
    if (!prop.name) return
    schema.schema.properties[prop.name] = buildPropertySchema(prop)
    if (prop.required) {
      schema.schema.required.push(prop.name)
    }
  })

  return JSON.stringify(schema, null, 2)
}
