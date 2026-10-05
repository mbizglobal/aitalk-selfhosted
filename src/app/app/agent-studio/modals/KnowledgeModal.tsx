import React, { useState } from 'react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  X,
  Plus,
  Upload,
  Link,
  Database,
  FileText,
  Globe,
  HardDrive,
  Trash2,
  Download,
  GripHorizontal
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'

export const KnowledgeModal: React.FC = () => {
  const { ui, agent } = useWorkflowContext()
  const [activeTab, setActiveTab] = useState('files')
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [databaseConnection, setDatabaseConnection] = useState('')

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setUploadedFiles(prev => [...prev, ...files])
  }

  const handleAddWebsite = () => {
    if (websiteUrl) {
      agent.setKnowledgeSources([
        ...agent.knowledgeSources,
        {
          id: Date.now().toString(),
          name: websiteUrl,
          type: 'website'
        }
      ])
      setWebsiteUrl('')
    }
  }

  const handleAddDatabase = () => {
    if (databaseConnection) {
      agent.setKnowledgeSources([
        ...agent.knowledgeSources,
        {
          id: Date.now().toString(),
          name: 'Database Connection',
          type: 'database'
        }
      ])
      setDatabaseConnection('')
    }
  }

  const handleRemoveSource = (id: string) => {
    agent.setKnowledgeSources(
      agent.knowledgeSources.filter(s => s.id !== id)
    )
  }

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showKnowledgeModal })

  if (!ui.showKnowledgeModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
      <div className="w-[600px] max-h-[80vh] bg-white rounded-lg shadow-lg overflow-hidden" style={dragStyle}>
        <div
          className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold">지식베이스 설정</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => ui.setShowKnowledgeModal(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto scrollbar-thin max-h-[60vh]">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="files" className="flex-1">
                <FileText className="w-4 h-4 mr-2" />
                파일
              </TabsTrigger>
              <TabsTrigger value="website" className="flex-1">
                <Globe className="w-4 h-4 mr-2" />
                웹사이트
              </TabsTrigger>
              <TabsTrigger value="database" className="flex-1">
                <Database className="w-4 h-4 mr-2" />
                데이터베이스
              </TabsTrigger>
              <TabsTrigger value="storage" className="flex-1">
                <HardDrive className="w-4 h-4 mr-2" />
                스토리지
              </TabsTrigger>
            </TabsList>

            {/* Files Tab */}
            <TabsContent value="files" className="space-y-4 mt-4">
              <div>
                <Label>파일 업로드</Label>
                <div className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600 mb-2">
                    클릭하거나 파일을 드래그하여 업로드
                  </p>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button variant="outline" size="sm" asChild>
                      <span>파일 선택</span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <Label>업로드된 파일</Label>
                  {uploadedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{file.name}</span>
                        <span className="text-xs text-gray-500">
                          ({(file.size / 1024).toFixed(2)} KB)
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Website Tab */}
            <TabsContent value="website" className="space-y-4 mt-4">
              <div>
                <Label>웹사이트 URL</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                  />
                  <Button onClick={handleAddWebsite}>
                    <Plus className="w-4 h-4 mr-1" />
                    추가
                  </Button>
                </div>
              </div>

              {/* Website List */}
              <div className="space-y-2">
                <Label>연결된 웹사이트</Label>
                {agent.knowledgeSources
                  .filter(s => s.type === 'website')
                  .map(source => (
                    <div key={source.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex items-center gap-2">
                        <Link className="w-4 h-4 text-gray-500" />
                        <span className="text-sm">{source.name}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveSource(source.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
              </div>
            </TabsContent>

            {/* Database Tab */}
            <TabsContent value="database" className="space-y-4 mt-4">
              <div>
                <Label>데이터베이스 연결 문자열</Label>
                <div className="space-y-2 mt-2">
                  <Input
                    value={databaseConnection}
                    onChange={(e) => setDatabaseConnection(e.target.value)}
                    placeholder="postgresql://user:password@host:port/database"
                    type="password"
                  />
                  <Button onClick={handleAddDatabase} className="w-full">
                    <Database className="w-4 h-4 mr-2" />
                    데이터베이스 연결
                  </Button>
                </div>
              </div>

              {/* Connected Databases */}
              {agent.knowledgeSources.some(s => s.type === 'database') && (
                <div className="space-y-2">
                  <Label>연결된 데이터베이스</Label>
                  {agent.knowledgeSources
                    .filter(s => s.type === 'database')
                    .map(source => (
                      <div key={source.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-gray-500" />
                          <span className="text-sm">{source.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveSource(source.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                </div>
              )}
            </TabsContent>

            {/* Storage Tab */}
            <TabsContent value="storage" className="space-y-4 mt-4">
              <div className="text-center py-8">
                <HardDrive className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">클라우드 스토리지 연결 기능</p>
                <p className="text-sm text-gray-500 mt-2">
                  Google Drive, Dropbox, OneDrive 등
                </p>
                <Button variant="outline" className="mt-4" disabled>
                  곧 지원 예정
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Footer */}
        <div className="flex justify-between px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={() => ui.setShowKnowledgeModal(false)}
          >
            취소
          </Button>
          <Button
            onClick={() => {
              // Save logic here
              ui.setShowKnowledgeModal(false)
            }}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}