'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, ChevronDown, ChevronRight, GripHorizontal, X, RefreshCw } from 'lucide-react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { isAiNode } from '../utils'
import type { SchemaProperty } from '../types/schema'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useDraggable } from '../hooks/useDraggable'

const MAX_DEPTH = 5

const DEPTH_COLORS = [
  'border-purple-500/30',
  'border-pink-500/30',
  'border-blue-500/30',
  'border-green-500/30',
  'border-yellow-500/30',
]

function buildPropertySchema(prop: SchemaProperty): any {
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
      propSchema.properties[nestedProp.name] = buildPropertySchema(nestedProp)
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
          propSchema.items.properties[itemProp.name] = buildPropertySchema(itemProp)
          if (itemProp.required) propSchema.items.required.push(itemProp.name)
        })
      } else {
        propSchema.items.type = prop.itemsType
      }
    }
  }

  return propSchema
}

function parseSchemaProperties(schemaObj: any, requiredFields: string[] = []): SchemaProperty[] {
  const result: SchemaProperty[] = []

  if (!schemaObj.properties) return result

  Object.entries(schemaObj.properties).forEach(([propName, propValue]: [string, any]) => {
    const baseProp: SchemaProperty = {
      id: Date.now().toString() + Math.random(),
      name: propName,
      type: propValue.enum ? 'enum' : propValue.type,
      description: propValue.description || '',
      required: requiredFields.includes(propName),
      enumValues: propValue.enum || undefined,
    }

    if (propValue.type === 'object' && propValue.properties) {
      baseProp.properties = parseSchemaProperties(propValue, propValue.required || [])
    }

    if (propValue.type === 'array' && propValue.items) {
      const items = propValue.items
      baseProp.itemsType = items.enum ? 'enum' : items.type
      baseProp.itemsEnumValues = items.enum || undefined

      if (items.type === 'object' && items.properties) {
        baseProp.itemsProperties = parseSchemaProperties(items, items.required || [])
      }
    }

    result.push(baseProp)
  })

  return result
}

interface PropertyRowProps {
  prop: SchemaProperty
  depth: number
  onUpdate: (updated: SchemaProperty) => void
  onDelete: () => void
  t: any
}

function PropertyRow({ prop, depth, onUpdate, onDelete, t }: PropertyRowProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const canAddNested = depth < MAX_DEPTH
  const isCompact = depth > 0

  const handleTypeChange = (newType: string) => {
    const updated = { ...prop, type: newType as any }
    if (newType === 'object' && !updated.properties) {
      updated.properties = []
    }
    if (newType === 'array') {
      updated.itemsType = updated.itemsType || 'string'
    }
    onUpdate(updated)
  }

  const handleNestedPropertyUpdate = (index: number, updated: SchemaProperty) => {
    const newProperties = [...(prop.properties || [])]
    newProperties[index] = updated
    onUpdate({ ...prop, properties: newProperties })
  }

  const handleNestedPropertyDelete = (index: number) => {
    const newProperties = (prop.properties || []).filter((_, i) => i !== index)
    onUpdate({ ...prop, properties: newProperties })
  }

  const handleAddNestedProperty = () => {
    onUpdate({
      ...prop,
      properties: [
        ...(prop.properties || []),
        {
          id: Date.now().toString() + Math.random(),
          name: '',
          type: 'string',
          description: '',
          required: false,
        }
      ]
    })
  }

  const handleItemsPropertyUpdate = (index: number, updated: SchemaProperty) => {
    const newItemsProperties = [...(prop.itemsProperties || [])]
    newItemsProperties[index] = updated
    onUpdate({ ...prop, itemsProperties: newItemsProperties })
  }

  const handleItemsPropertyDelete = (index: number) => {
    const newItemsProperties = (prop.itemsProperties || []).filter((_, i) => i !== index)
    onUpdate({ ...prop, itemsProperties: newItemsProperties })
  }

  const handleAddItemsProperty = () => {
    onUpdate({
      ...prop,
      itemsProperties: [
        ...(prop.itemsProperties || []),
        {
          id: Date.now().toString() + Math.random(),
          name: '',
          type: 'string',
          description: '',
          required: false,
        }
      ]
    })
  }

  return (
    <div className="space-y-2">
      {/* Main Row */}
      <div className="grid grid-cols-12 gap-2 items-start">
        <div className="col-span-3">
          <Input
            value={prop.name}
            onChange={(e) => onUpdate({ ...prop, name: e.target.value })}
            className={`bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 ${isCompact ? 'text-xs h-8' : 'text-sm h-9'}`}
            placeholder={t.property_name}
          />
        </div>
        <div className="col-span-2">
          <select
            value={prop.type}
            onChange={(e) => handleTypeChange(e.target.value)}
            className={`w-full px-2 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 ${isCompact ? 'text-xs h-8 py-1' : 'text-sm h-9 py-2'}`}
          >
            {isCompact ? (
              <>
                <option value="string">STR</option>
                <option value="number">NUM</option>
                <option value="boolean">BOOL</option>
                <option value="enum">ENUM</option>
                {canAddNested && <option value="array">ARR</option>}
                {canAddNested && <option value="object">OBJ</option>}
              </>
            ) : (
              <>
                <option value="string">STRING</option>
                <option value="number">NUMBER</option>
                <option value="boolean">BOOLEAN</option>
                <option value="enum">ENUM</option>
                <option value="array">ARRAY</option>
                <option value="object">OBJECT</option>
              </>
            )}
          </select>
        </div>
        <div className="col-span-5">
          <Input
            value={prop.description}
            onChange={(e) => onUpdate({ ...prop, description: e.target.value })}
            className={`bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 ${isCompact ? 'text-xs h-8' : 'text-sm h-9'}`}
            placeholder={t.add_description}
          />
        </div>
        <div className="col-span-2 flex items-center gap-1">
          <label className={`flex items-center gap-1 text-gray-300 cursor-pointer ${isCompact ? 'text-xs' : 'text-xs'}`}>
            <input
              type="checkbox"
              checked={prop.required}
              onChange={(e) => onUpdate({ ...prop, required: e.target.checked })}
              className={isCompact ? 'w-3 h-3' : 'w-4 h-4'}
            />
            {isCompact ? t.required?.substring(0, 3) || 'Req' : t.required}
          </label>
          <button
            onClick={onDelete}
            className="p-1 hover:bg-[#3A3A3A] rounded transition-colors"
          >
            <Trash2 className={`text-gray-400 ${isCompact ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>
        </div>
      </div>

      {/* ENUM values */}
      {prop.type === 'enum' && (
        <div className="col-span-12">
          <Input
            value={prop.enumValues?.join(', ') || ''}
            onChange={(e) => onUpdate({ ...prop, enumValues: e.target.value.split(',').map(v => v.trim()) })}
            className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 text-xs"
            placeholder="value1, value2, value3"
          />
        </div>
      )}

      {/* OBJECT nested properties */}
      {prop.type === 'object' && canAddNested && (
        <div className={`ml-6 border-l-2 ${DEPTH_COLORS[depth % DEPTH_COLORS.length]} pl-4 space-y-2`}>
          <div
            className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer hover:text-gray-300"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {t.object_properties_depth} {depth + 1}/{MAX_DEPTH}):
          </div>

          {isExpanded && (
            <>
              {(prop.properties || []).map((nestedProp, index) => (
                <PropertyRow
                  key={nestedProp.id}
                  prop={nestedProp}
                  depth={depth + 1}
                  onUpdate={(updated) => handleNestedPropertyUpdate(index, updated)}
                  onDelete={() => handleNestedPropertyDelete(index)}
                  t={t}
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddNestedProperty}
                className="text-gray-400 hover:text-gray-200 h-7 text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                {t.add_nested_property}
              </Button>
            </>
          )}
        </div>
      )}

      {/* ARRAY items configuration */}
      {prop.type === 'array' && (
        <div className={`ml-6 border-l-2 ${DEPTH_COLORS[depth % DEPTH_COLORS.length]} pl-4 space-y-2`}>
          <div className="text-xs text-gray-400 mb-2">{t.array_items}</div>
          <div className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-3">
              <div className="text-xs text-gray-500 mb-1">{t.items_type}</div>
              <select
                value={prop.itemsType || 'string'}
                onChange={(e) => {
                  const newItemsType = e.target.value as any
                  onUpdate({
                    ...prop,
                    itemsType: newItemsType,
                    itemsProperties: newItemsType === 'object' ? (prop.itemsProperties || []) : undefined
                  })
                }}
                className="w-full px-2 py-1 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 text-xs h-8"
              >
                <option value="string">STR</option>
                <option value="number">NUM</option>
                <option value="boolean">BOOL</option>
                <option value="enum">ENUM</option>
                {canAddNested && <option value="object">OBJ</option>}
              </select>
            </div>
            <div className="col-span-9">
              <div className="text-xs text-gray-500 mb-1">{t.items_description}</div>
              <Input
                value={prop.description}
                onChange={(e) => onUpdate({ ...prop, description: e.target.value })}
                className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 text-xs h-8"
                placeholder={t.description_array_items}
              />
            </div>
          </div>

          {/* ENUM items */}
          {prop.itemsType === 'enum' && (
            <div className="mt-2">
              <Input
                value={prop.itemsEnumValues?.join(', ') || ''}
                onChange={(e) => onUpdate({ ...prop, itemsEnumValues: e.target.value.split(',').map(v => v.trim()) })}
                className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200 text-xs"
                placeholder="value1, value2, value3"
              />
            </div>
          )}

          {/* OBJECT items */}
          {prop.itemsType === 'object' && canAddNested && (
            <div className="mt-3 space-y-2">
              <div
                className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer hover:text-gray-300"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {t.object_properties_depth} {depth + 1}/{MAX_DEPTH}):
              </div>

              {isExpanded && (
                <>
                  {(prop.itemsProperties || []).map((itemProp, index) => (
                    <PropertyRow
                      key={itemProp.id}
                      prop={itemProp}
                      depth={depth + 1}
                      onUpdate={(updated) => handleItemsPropertyUpdate(index, updated)}
                      onDelete={() => handleItemsPropertyDelete(index)}
                      t={t}
                    />
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAddItemsProperty}
                    className="text-gray-400 hover:text-gray-200 h-7 text-xs"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    {t.add_item_property}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function JsonSchemaModal() {
  const { ui, agent, workflow, nodeHandlers, reloadWorkflow } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  // Modes
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [isModeSwitching, setIsModeSwitching] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)

  // Simple mode
  const [schemaName, setSchemaName] = useState('json_schema')
  const [properties, setProperties] = useState<SchemaProperty[]>([])

  // Advanced mode
  const [rawSchema, setRawSchema] = useState('')

  const [initialRawSchema, setInitialRawSchema] = useState('')
  const [shouldSyncInitial, setShouldSyncInitial] = useState(false)

  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const [showJsonError, setShowJsonError] = useState(false)

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showJsonSchemaModal })

  const activeAiNode = useMemo(
    () =>
      workflow.nodes.find(node => node.id === workflow.selectedNode && isAiNode(node)) ||
      workflow.nodes.find(isAiNode),
    [workflow.nodes, workflow.selectedNode]
  )

  useEffect(() => {
    if (mode !== 'simple' || !isModeSwitching) return

    try {
      const parsedSchema = JSON.parse(rawSchema)

      if (parsedSchema.name) {
        setSchemaName(parsedSchema.name)
      }

      const schemaObj = parsedSchema.schema || parsedSchema
      const requiredFields = parsedSchema.schema?.required || parsedSchema.required || []

      setProperties(parseSchemaProperties(schemaObj, requiredFields))
    } catch (error) {
      console.error('Failed to parse schema when switching to Simple mode:', error)
      setShowJsonError(true)
      setMode('advanced')
    } finally {
      setIsModeSwitching(false)
    }
  }, [mode, isModeSwitching, rawSchema])

  useEffect(() => {
    if (mode !== 'simple') return
    if (isModeSwitching) return

    const schema: any = {
      name: schemaName,
      strict: true,
      schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    }

    if (properties.length === 0) {
      const newSchema = JSON.stringify(schema, null, 2)
      setRawSchema(newSchema)
      if (shouldSyncInitial) {
        setInitialRawSchema(newSchema)
        setShouldSyncInitial(false)
      }
      return
    }

    properties.forEach(prop => {
      if (!prop.name) return
      schema.schema.properties[prop.name] = buildPropertySchema(prop)
      if (prop.required) {
        schema.schema.required.push(prop.name)
      }
    })

    const newSchema = JSON.stringify(schema, null, 2)
    setRawSchema(newSchema)
    if (shouldSyncInitial) {
      setInitialRawSchema(newSchema)
      setShouldSyncInitial(false)
    }
  }, [properties, schemaName, mode, isModeSwitching, shouldSyncInitial])

  useEffect(() => {
    if (!ui.showJsonSchemaModal) {
      setIsInitialized(false)
      setShouldSyncInitial(false)
      return
    }

    if (isInitialized) return

    const nodeData = activeAiNode?.data

    const schema = nodeData?.jsonSchema || agent.aiJsonSchema || JSON.stringify({
      name: 'json_schema',
      strict: true,
      schema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    }, null, 2)

    const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2)

    if (nodeData?.schemaProperties && nodeData.schemaProperties.length > 0) {
      setSchemaName(nodeData?.schemaName || 'json_schema')
      setProperties(nodeData.schemaProperties)
    } else {
      try {
        const parsedSchema = JSON.parse(schemaStr)
        setSchemaName(parsedSchema.name || 'json_schema')
        const schemaObj = parsedSchema.schema || parsedSchema
        const requiredFields = schemaObj?.required || []
        setProperties(parseSchemaProperties(schemaObj, requiredFields))
      } catch {
        setSchemaName('json_schema')
        setProperties([])
      }
    }

    setRawSchema(schemaStr)
    setIsModeSwitching(false)
    setIsInitialized(true)
    setShouldSyncInitial(true)
  }, [ui.showJsonSchemaModal, isInitialized, activeAiNode, agent.aiJsonSchema])

  if (!ui.showJsonSchemaModal) return null

  const updateSelectedAiNodeData = (data: any) => {
    if (activeAiNode) {
      nodeHandlers.updateNodeData(activeAiNode.id, data)
    }
  }

  const handlePropertyUpdate = (index: number, updated: SchemaProperty) => {
    const newProperties = [...properties]
    newProperties[index] = updated
    setProperties(newProperties)
  }

  const handlePropertyDelete = (index: number) => {
    setProperties(properties.filter((_, i) => i !== index))
  }

  const handleAddProperty = () => {
    setProperties([
      ...properties,
      {
        id: Date.now().toString(),
        name: '',
        type: 'string',
        description: '',
        required: false,
      }
    ])
  }

  const handleSave = () => {
    let propsToSave = properties
    let nameToSave = schemaName

    if (mode === 'advanced') {
      try {
        const parsedSchema = JSON.parse(rawSchema)

        nameToSave = parsedSchema.name || schemaName
        if (parsedSchema.name) {
          setSchemaName(parsedSchema.name)
        }

        const schemaObj = parsedSchema.schema || parsedSchema
        const requiredFields = parsedSchema.schema?.required || parsedSchema.required || []

        propsToSave = parseSchemaProperties(schemaObj, requiredFields)
        setProperties(propsToSave)
      } catch (error) {
        setShowJsonError(true)
        return
      }
    }

    agent.setAiJsonSchema(rawSchema)
    updateSelectedAiNodeData({
      jsonSchema: rawSchema,
      schemaName: nameToSave,
      schemaProperties: propsToSave
    })
    ui.setShowJsonSchemaModal(false)
  }

  const hasChanges = rawSchema !== initialRawSchema

  const handleClose = () => {
    if (hasChanges) {
      setShowConfirmDialog(true)
    } else {
      ui.setShowJsonSchemaModal(false)
    }
  }

  const handleDiscardAndClose = () => {
    setShowConfirmDialog(false)
    ui.setShowJsonSchemaModal(false)
  }

  const handleSaveAndClose = () => {
    setShowConfirmDialog(false)
    handleSave()
  }

  return (
    <>
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-4xl w-full max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200">{t.structured_output_json}</h2>
              <p className="text-sm text-gray-400 mt-1">{t.structured_output_desc}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-[#1a1a1a] rounded-lg p-1">
            <button
              onClick={() => {
                if (mode === 'simple') return
                setIsModeSwitching(true)
                setMode('simple')
              }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'simple'
                  ? 'bg-white text-black'
                  : 'bg-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.simple}
            </button>
            <button
              onClick={() => {
                if (mode === 'advanced') return
                setMode('advanced')
              }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'advanced'
                  ? 'bg-white text-black'
                  : 'bg-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.advanced}
            </button>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={async () => {
                if ((rawSchema !== initialRawSchema || ui.hasChanges) && !window.confirm(t.reload_discard_confirm || t.unsaved_changes_confirm)) return
                const result = await reloadWorkflow()
                if (result) setIsInitialized(false)
              }}
              className="p-1.5 rounded transition-colors text-gray-400 hover:text-gray-200"
              title={t.reload_workflow || 'Reload from server'}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          {mode === 'simple' ? (
            <div className="space-y-6">
              {/* Name */}
              <div>
                <label className="text-sm font-medium text-gray-200 mb-2 block">{t.name}</label>
                <Input
                  value={schemaName}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
                  placeholder="json_schema"
                />
              </div>

              {/* Properties */}
              <div>
                <label className="text-sm font-medium text-gray-200 mb-3 block">
                  {t.properties} <span className="text-xs text-gray-500">({t.max_depth}: {MAX_DEPTH})</span>
                </label>
                <div className="space-y-3">
                  {/* Header Row */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-gray-400 px-2">
                    <div className="col-span-3">{t.name}</div>
                    <div className="col-span-2">{t.type}</div>
                    <div className="col-span-5">{t.description}</div>
                    <div className="col-span-2"></div>
                  </div>

                  {/* Property Rows */}
                  {properties.map((prop, index) => (
                    <div key={prop.id} className={index > 0 ? 'pt-4 border-t border-gray-700' : ''}>
                      <PropertyRow
                        prop={prop}
                        depth={0}
                        onUpdate={(updated) => handlePropertyUpdate(index, updated)}
                        onDelete={() => handlePropertyDelete(index)}
                        t={t}
                      />
                    </div>
                  ))}

                  {/* Add Property Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddProperty}
                    className="border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A] h-9 w-full"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t.add_property}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                {t.advanced_mode_note}
              </p>
              <Textarea
                value={rawSchema}
                onChange={(e) => setRawSchema(e.target.value)}
                className="bg-[#1a1a1a] border-[#3A3A3A] text-gray-200 min-h-[400px] font-mono text-sm resize-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#3A3A3A] flex items-center justify-end">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              className="border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
            >
              {t.cancel}
            </Button>
            <Button onClick={handleSave}>
              {t.update}
            </Button>
          </div>
        </div>
      </div>
    </div>

    {showConfirmDialog && (
      <div
        className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      >
        <div
          className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-md w-full p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-gray-200 mb-2">{t.unsaved_changes}</h3>
          <p className="text-sm text-gray-400 mb-6">
            {t.unsaved_changes_desc}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSaveAndClose}
              className="w-full"
            >
              {t.save_and_close}
            </Button>
            <Button
              variant="outline"
              onClick={handleDiscardAndClose}
              className="w-full border-[#3A3A3A] text-gray-200 hover:bg-[#3A3A3A]"
            >
              {t.discard_changes}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowConfirmDialog(false)}
              className="w-full text-gray-400 hover:text-gray-200"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )}

    {showJsonError && (
      <div
        className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
      >
        <div
          className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] p-6 max-w-sm w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-lg font-semibold text-gray-200 mb-3">Error</h3>
          <p className="text-sm text-gray-400 mb-6">
            {t.invalid_json}
          </p>
          <Button
            onClick={() => setShowJsonError(false)}
            className="w-full"
          >
            OK
          </Button>
        </div>
      </div>
    )}
    </>
  )
}
