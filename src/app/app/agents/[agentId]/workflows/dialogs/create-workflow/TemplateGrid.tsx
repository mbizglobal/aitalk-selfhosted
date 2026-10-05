'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { TemplateCard } from './TemplateCard'
import { CategoryFilter } from './CategoryFilter'
import { SearchBar } from './SearchBar'
import type { WorkflowTemplate, Category, CreateWorkflowTranslations } from './types'

interface TemplateGridProps {
  onBack: () => void
  onSelectTemplate: (template: WorkflowTemplate) => void
  t: CreateWorkflowTranslations
}

export function TemplateGrid({ onBack, onSelectTemplate, t }: TemplateGridProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [templatesRes, categoriesRes] = await Promise.all([
          fetch('/api/workflow-templates'),
          fetch('/api/workflow-templates/categories'),
        ])

        if (templatesRes.ok) {
          const data = await templatesRes.json()
          setTemplates(data.templates || [])
        }

        if (categoriesRes.ok) {
          const data = await categoriesRes.json()
          setCategories(data.categories || [])
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const filteredTemplates = templates.filter((template) => {
    const matchesCategory = !selectedCategory || template.categoryCode === selectedCategory
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.keywords.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchesCategory && matchesSearch
  })

  return (
    <div className="flex flex-col max-h-[calc(100svh-10rem)]">
      {/* Header - Back button */}
      <div className="shrink-0 pt-4 pb-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t.workflow_back || 'Back'}
        </button>
      </div>

      {/* Search and Filter - Fixed */}
      <div className="shrink-0 flex gap-2 pb-4">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t.workflow_template_search || 'Search templates...'}
        />
        <CategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={setSelectedCategory}
          allLabel={t.workflow_template_all_categories || 'All Categories'}
        />
      </div>

      {/* Scrollable template list */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {t.workflow_template_no_results || 'No templates found'}
          </div>
        ) : (
          <div className="flex flex-col gap-3 pr-1">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.templateId}
                template={template}
                onClick={() => onSelectTemplate(template)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
