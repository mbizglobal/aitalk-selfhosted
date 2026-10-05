import React, { useState } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { restoreNodesWithIcons } from '../utils/nodeUtils'
import {
  X,
  Save,
  Download,
  Upload,
  FileText,
  Clock,
  Tag,
  Search,
  Grid,
  List,
  Star,
  StarOff,
  Trash2,
  Copy,
  Share2,
  GripHorizontal
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

interface Template {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  createdAt: Date
  updatedAt: Date
  isFavorite: boolean
  thumbnail?: string
  nodes: any[]
  edges: any[]
  settings?: any
}

interface TemplateModalProps {
  mode: 'save' | 'load'
}

export const TemplateModal: React.FC<TemplateModalProps> = ({ mode }) => {
  const { ui, workflow, agent } = useWorkflowContext()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

  // Save template states
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateCategory, setTemplateCategory] = useState('general')
  const [templateTags, setTemplateTags] = useState('')

  const [templates] = useState<Template[]>([
    {
      id: '1',
      name: 'Customer Support Bot',
      description: '고객 지원을 위한 기본 템플릿',
      category: 'support',
      tags: ['customer', 'support', 'chat'],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      isFavorite: true,
      nodes: [],
      edges: []
    },
    {
      id: '2',
      name: 'Data Analysis Workflow',
      description: '데이터 분석 및 시각화 워크플로우',
      category: 'analytics',
      tags: ['data', 'analysis', 'visualization'],
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02'),
      isFavorite: false,
      nodes: [],
      edges: []
    }
  ])

  const categories = [
    { value: 'all', label: '전체', icon: Grid },
    { value: 'general', label: '일반', icon: FileText },
    { value: 'support', label: '고객지원', icon: FileText },
    { value: 'analytics', label: '분석', icon: FileText },
    { value: 'automation', label: '자동화', icon: FileText }
  ]

  const handleSaveTemplate = () => {
    if (!templateName) {
      alert('템플릿 이름을 입력해주세요.')
      return
    }

    const newTemplate: Template = {
      id: Date.now().toString(),
      name: templateName,
      description: templateDescription,
      category: templateCategory,
      tags: templateTags.split(',').map(t => t.trim()).filter(t => t),
      createdAt: new Date(),
      updatedAt: new Date(),
      isFavorite: false,
      nodes: workflow.nodes,
      edges: workflow.edges,
      settings: agent.getAgentSettings()
    }

    agent.saveTemplate(newTemplate as any)
    ui.setShowSaveTemplateModal(false)

    // Reset form
    setTemplateName('')
    setTemplateDescription('')
    setTemplateCategory('general')
    setTemplateTags('')
  }

  const handleLoadTemplate = (template: Template) => {
    if (confirm(`"${template.name}" 템플릿을 불러오시겠습니까? 현재 작업이 덮어씌워집니다.`)) {
      // Restore icons for template nodes
      const nodesWithIcons = restoreNodesWithIcons(template.nodes)
      workflow.setNodes(nodesWithIcons)
      workflow.setEdges(template.edges)
      if (template.settings) {
        agent.updateAiSettings(template.settings)
      }
      ui.setShowLoadTemplateModal(false)
    }
  }

  const handleDeleteTemplate = (templateId: string) => {
    if (confirm('이 템플릿을 삭제하시겠습니까?')) {
      agent.deleteTemplate(templateId)
    }
  }

  const handleExportTemplate = (template: Template) => {
    const data = JSON.stringify(template, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${template.name.replace(/\s+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredTemplates = templates.filter(template => {
    if (selectedCategory !== 'all' && template.category !== selectedCategory) {
      return false
    }
    if (searchQuery && !template.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !template.description.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    return true
  })

  const isModalOpen = mode === 'save' ? ui.showSaveTemplateModal : ui.showLoadTemplateModal

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: isModalOpen })

  if (!isModalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
      <div className="w-[800px] max-h-[90vh] bg-white rounded-lg shadow-lg overflow-hidden" style={dragStyle}>
        <div
          className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold">
              {mode === 'save' ? '템플릿 저장' : '템플릿 불러오기'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => mode === 'save' ? ui.setShowSaveTemplateModal(false) : ui.setShowLoadTemplateModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto scrollbar-thin max-h-[70vh]">
          {mode === 'save' ? (
            // Save Template Form
            <div className="space-y-4">
              <div>
                <Label>템플릿 이름 *</Label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="템플릿 이름을 입력하세요"
                  className="mt-2"
                />
              </div>

              <div>
                <Label>설명</Label>
                <Textarea
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder="템플릿에 대한 설명을 입력하세요"
                  rows={3}
                  className="mt-2"
                />
              </div>

              <div>
                <Label>카테고리</Label>
                <select
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  className="w-full mt-2 p-2 border rounded"
                >
                  {categories.filter(c => c.value !== 'all').map(category => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>태그</Label>
                <Input
                  value={templateTags}
                  onChange={(e) => setTemplateTags(e.target.value)}
                  placeholder="태그를 쉼표로 구분하여 입력 (예: chat, support, automation)"
                  className="mt-2"
                />
              </div>

              <div className="p-4 bg-blue-50 rounded">
                <h4 className="font-medium mb-2">저장될 내용</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• 노드: {workflow.nodes.length}개</li>
                  <li>• 연결: {workflow.edges.length}개</li>
                  <li>• AI 설정 (모델, 온도, 시스템 메시지 등)</li>
                  <li>• 도구 및 지식베이스 설정</li>
                </ul>
              </div>
            </div>
          ) : (
            // Load Template List
            <div className="space-y-4">
              {/* Search and Filter */}
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="템플릿 검색..."
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                  >
                    <Grid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Category Tabs */}
              <div className="flex gap-2">
                {categories.map(category => (
                  <Button
                    key={category.value}
                    variant={selectedCategory === category.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(category.value)}
                  >
                    {category.label}
                  </Button>
                ))}
              </div>

              {/* Templates Grid/List */}
              {filteredTemplates.length > 0 ? (
                <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-4' : 'space-y-2'}>
                  {filteredTemplates.map(template => (
                    <div
                      key={template.id}
                      className={`
                        border rounded-lg p-4 hover:border-blue-400 cursor-pointer transition-colors
                        ${selectedTemplate?.id === template.id ? 'border-blue-500 bg-blue-50' : ''}
                      `}
                      onClick={() => setSelectedTemplate(template)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-medium">{template.name}</h3>
                          <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // Toggle favorite
                          }}
                        >
                          {template.isFavorite ? (
                            <Star className="w-4 h-4 text-yellow-500 fill-current" />
                          ) : (
                            <StarOff className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {template.tags.map(tag => (
                          <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Meta Info */}
                      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(template.updatedAt).toLocaleDateString()}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleExportTemplate(template)
                            }}
                          >
                            <Download className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteTemplate(template.id)
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>템플릿이 없습니다</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={() => mode === 'save' ? ui.setShowSaveTemplateModal(false) : ui.setShowLoadTemplateModal(false)}
          >
            취소
          </Button>
          <Button
            onClick={() => {
              if (mode === 'save') {
                handleSaveTemplate()
              } else if (selectedTemplate) {
                handleLoadTemplate(selectedTemplate)
              }
            }}
            disabled={mode === 'load' && !selectedTemplate}
          >
            {mode === 'save' ? (
              <>
                <Save className="w-4 h-4 mr-2" />
                저장
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                불러오기
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}