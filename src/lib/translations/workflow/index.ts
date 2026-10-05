// Workflow translations index
import { translations as en } from './en'
import { translations as ko } from './ko'
import { translations as de } from './de'
import { translations as fr } from './fr'
import { translations as es } from './es'

export type WorkflowTranslationKey = keyof typeof en.en

export const workflowTranslations = {
  ...en,
  ...ko,
  ...de,
  ...fr,
  ...es,
}

export type WorkflowTranslations = typeof workflowTranslations

// Helper function to get translation
export function getWorkflowTranslation(lang: string): Record<string, string> {
  const supportedLang = ['en', 'ko', 'de', 'fr', 'es'].includes(lang) ? lang : 'en'
  return workflowTranslations[supportedLang as keyof WorkflowTranslations] || workflowTranslations.en
}

// Helper function to get single translation with interpolation
export function t(lang: string, key: WorkflowTranslationKey, params?: Record<string, string>): string {
  const translations = getWorkflowTranslation(lang)
  let text = translations[key] || en.en[key] || key

  // Replace placeholders like {field} or {context}
  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue)
    }
  }

  return text
}

/**
 * Parse OpenAI JSON Schema error and return user-friendly message
 *
 * Example error:
 * "Invalid schema for response_format 'output_schema': In context=('properties', 'items', 'items'),
 *  'required' is required to be supplied and to be an array including every key in properties. Missing 'quantity'."
 */
export function parseJsonSchemaError(lang: string, errorMessage: string): string {
  const translations = getWorkflowTranslation(lang)

  // Pattern: Missing 'fieldName' in context
  const missingFieldMatch = errorMessage.match(/Missing '([^']+)'/)
  const contextMatch = errorMessage.match(/context=\(([^)]+)\)/)

  if (missingFieldMatch) {
    const field = missingFieldMatch[1]
    let context = 'object'

    if (contextMatch) {
      // Convert ('properties', 'items', 'items') to readable path
      const parts = contextMatch[1]
        .split(',')
        .map(s => s.trim().replace(/'/g, ''))
        .filter(s => s !== 'properties') // Remove 'properties' for clarity

      if (parts.length > 0) {
        context = parts.join('.')
      }
    }

    const title = translations.json_schema_error_title
    const message = t(lang, 'json_schema_missing_required', { context, field })
    const hint = translations.json_schema_missing_required_hint

    return `${title}: ${message}\n\n${hint}`
  }

  // Pattern: additionalProperties is required
  if (errorMessage.includes("'additionalProperties' is required")) {
    const title = translations.json_schema_error_title
    const message = translations.json_schema_additional_properties_required
    const hint = translations.json_schema_additional_properties_hint

    return `${title}: ${message}\n\n${hint}`
  }

  // If can't parse, return generic schema error
  if (errorMessage.includes('json_schema') || errorMessage.includes('Invalid schema')) {
    return `${translations.json_schema_error_title}: ${translations.json_schema_invalid}`
  }

  return `${translations.json_schema_error_title}: ${translations.json_schema_invalid}`
}
