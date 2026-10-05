/**
 * Local Workflow Templates Utility
 *
 * Handles file-based template management in src/data/workflow-templates/
 */

import fs from 'fs'
import path from 'path'

// Local templates directory path
const TEMPLATES_DIR = path.join(process.cwd(), 'src/data/workflow-templates')
const CATEGORIES_FILE = '_categories.json'

// Type definitions
export interface LocalCategory {
  code: string
  name: string
  description?: string
  sortOrder: number
}

export interface DataSheetColumn {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface DataSheetSchema {
  name: string
  description?: string
  columns: DataSheetColumn[]
}

export interface LocalTemplate {
  templateId: string
  name: string
  description: string
  categoryCode: string
  complexity: 'beginner' | 'intermediate' | 'advanced'
  keywords: string[]
  nodeTypes: string[]
  features: string[]
  explanation: string
  workflowJson: string
  sortOrder: number
  dataSheetSchema?: DataSheetSchema
  bundleVersion?: number
  group?: unknown
  dataSheets?: unknown
  subWorkflows?: unknown
  wiring?: unknown
}

/**
 * Get all local categories
 */
export function getLocalCategories(): LocalCategory[] {
  const filePath = path.join(TEMPLATES_DIR, CATEGORIES_FILE)

  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as LocalCategory[]
  } catch (error) {
    console.error('Error reading local categories:', error)
    return []
  }
}

/**
 * Save local categories
 */
export function saveLocalCategories(categories: LocalCategory[]): void {
  const filePath = path.join(TEMPLATES_DIR, CATEGORIES_FILE)
  fs.writeFileSync(filePath, JSON.stringify(categories, null, 2), 'utf-8')
}

/**
 * Get all local templates
 */
export function getLocalTemplates(): LocalTemplate[] {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return []
  }

  const files = fs.readdirSync(TEMPLATES_DIR)
  const templates: LocalTemplate[] = []

  for (const file of files) {
    // Skip categories file and non-json files
    if (file === CATEGORIES_FILE || !file.endsWith('.json')) {
      continue
    }

    try {
      const filePath = path.join(TEMPLATES_DIR, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const template = JSON.parse(content) as LocalTemplate
      templates.push(template)
    } catch (error) {
      console.error(`Error reading template file ${file}:`, error)
    }
  }

  // Sort by sortOrder
  return templates.sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Get a single local template by templateId
 */
export function getLocalTemplate(templateId: string): LocalTemplate | null {
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.json`)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as LocalTemplate
  } catch (error) {
    console.error(`Error reading template ${templateId}:`, error)
    return null
  }
}

/**
 * Save a local template
 */
export function saveLocalTemplate(template: LocalTemplate): void {
  const filePath = path.join(TEMPLATES_DIR, `${template.templateId}.json`)
  fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8')
}

/**
 * Delete a local template
 */
export function deleteLocalTemplate(templateId: string): boolean {
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.json`)

  if (!fs.existsSync(filePath)) {
    return false
  }

  try {
    fs.unlinkSync(filePath)
    return true
  } catch (error) {
    console.error(`Error deleting template ${templateId}:`, error)
    return false
  }
}

/**
 * Check if a local template exists
 */
export function localTemplateExists(templateId: string): boolean {
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.json`)
  return fs.existsSync(filePath)
}

/**
 * Get templates directory path (for export/import)
 */
export function getTemplatesDir(): string {
  return TEMPLATES_DIR
}
