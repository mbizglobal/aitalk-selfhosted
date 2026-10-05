
import { evaluateSafeExpression } from '@/lib/workflow/safe-expression'
import { canReadTemplatePath } from '@/lib/workflow/template-scope'

function scoped(context: Record<string, any>): Record<string, any> {
  return { ...context, __templateVars: Object.keys(context ?? {}) }
}

export function evaluateSimpleCondition(
  context: Record<string, any>,
  field: string,
  operator: string,
  value: any
): boolean {
  const path = typeof field === 'string' && field.startsWith('context.') ? field.slice(8) : field
  if (!canReadTemplatePath(scoped(context), path)) return false

  //    (codex R6 #A)
  const fieldValue = context[path]

  switch (operator) {
    case '==':
      return fieldValue == value
    case '!=':
      return fieldValue != value
    case '>':
      return Number(fieldValue) > Number(value)
    case '<':
      return Number(fieldValue) < Number(value)
    case '>=':
      return Number(fieldValue) >= Number(value)
    case '<=':
      return Number(fieldValue) <= Number(value)
    default:
      console.warn(`Unknown operator: ${operator}`)
      return false
  }
}

export function evaluateBuilderConditions(
  context: Record<string, any>,
  logic: 'all' | 'any',
  conditions: Array<{
    field: string
    operator: string
    value: any
  }>
): boolean {
  if (conditions.length === 0) return false

  const results = conditions.map((condition) =>
    evaluateSimpleCondition(context, condition.field, condition.operator, condition.value)
  )

  if (logic === 'all') {
    return results.every((r) => r === true)
  } else {
    return results.some((r) => r === true)
  }
}

export function evaluateCustomExpression(
  context: Record<string, any>,
  expression: string
): boolean {
  if (!expression || expression.trim() === '') return false

  return evaluateSafeExpression(expression, scoped(context))
}

export function evaluateWhileCondition(
  context: Record<string, any>,
  node: {
    conditionMode: 'simple' | 'builder' | 'advanced'
    conditionField?: string
    conditionOperator?: string
    conditionValue?: any
    conditionLogic?: 'all' | 'any'
    conditions?: Array<{ field: string; operator: string; value: any }>
    customExpression?: string
  }
): boolean {
  const { conditionMode } = node

  if (conditionMode === 'simple') {
    // Simple Mode
    const { conditionField, conditionOperator, conditionValue } = node
    if (!conditionField) return false
    return evaluateSimpleCondition(
      context,
      conditionField,
      conditionOperator || '==',
      conditionValue
    )
  } else if (conditionMode === 'builder') {
    // Builder Mode
    const { conditionLogic, conditions } = node
    if (!conditions || conditions.length === 0) return false
    return evaluateBuilderConditions(context, conditionLogic || 'all', conditions)
  } else if (conditionMode === 'advanced') {
    // Advanced (Code) Mode
    const { customExpression } = node
    if (!customExpression) return false
    return evaluateCustomExpression(context, customExpression)
  }

  return false
}
