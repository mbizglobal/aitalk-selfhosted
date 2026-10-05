'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus,
  Edit,
  Trash2,
  Database,
  FileText,
  Table,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'

interface DataSheet {
  id: string
  agentId: string
  name: string
  description: string | null
  schema: string
  sizeBytes: bigint
  rowCount: number
  createdAt: Date
  updatedAt: Date
}

interface Agent {
  id: string
  agentId: string
  title: string
  userId: string
}

interface Props {
  agent: Agent
  initialDataSheets: DataSheet[]
}

export default function DataSheetsListClient({ agent, initialDataSheets }: Props) {
  const router = useRouter()
  const [dataSheets, setDataSheets] = useState<DataSheet[]>(initialDataSheets)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newSheetName, setNewSheetName] = useState('')
  const [newSheetDescription, setNewSheetDescription] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const formatSize = (bytes: bigint | number) => {
    const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes
    if (numBytes === 0) return '0 KB'
    if (numBytes < 1024) return '< 1 KB'
    if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(1)} KB`
    return `${(numBytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleCreateSheet = async () => {
    if (!newSheetName.trim()) {
      alert('데이터 시트 이름을 입력해주세요.')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          name: newSheetName,
          description: newSheetDescription || null,
          schema: {
            columns: [
              {
                name: 'id',
                type: 'string',
                required: true,
                description: '고유 ID'
              },
              {
                name: 'createdAt',
                type: 'datetime',
                required: true,
                description: '생성일시'
              }
            ]
          }
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create data sheet')
      }

      const data = await response.json()
      setDataSheets([data.sheet, ...dataSheets])
      setIsCreateDialogOpen(false)
      setNewSheetName('')
      setNewSheetDescription('')
      router.refresh()
    } catch (error: any) {
      console.error('Failed to create data sheet:', error)
      alert(error.message || '데이터 시트 생성에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteSheet = async (sheetId: string, name: string) => {
    if (!confirm(`"${name}" 데이터 시트를 삭제하시겠습니까?\n모든 데이터가 영구적으로 삭제됩니다.`)) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheetId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete data sheet')
      }

      setDataSheets(dataSheets.filter(s => s.id !== sheetId))
      router.refresh()
    } catch (error: any) {
      console.error('Failed to delete data sheet:', error)
      alert(error.message || '데이터 시트 삭제에 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  const getColumnCount = (schemaJson: string) => {
    try {
      const schema = JSON.parse(schemaJson)
      return schema.columns?.length || 0
    } catch {
      return 0
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{agent.title}</h1>
            <p className="text-muted-foreground mt-1">데이터 시트 관리</p>
          </div>

          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            새 데이터 시트
          </Button>
        </div>
      </div>

      {/* Data Sheets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dataSheets.map((sheet) => (
          <Card key={sheet.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <Database className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg truncate">{sheet.name}</CardTitle>
                    {sheet.description && (
                      <CardDescription className="mt-1 line-clamp-2">
                        {sheet.description}
                      </CardDescription>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Table className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {sheet.rowCount.toLocaleString()}개 행
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {getColumnCount(sheet.schema)}개 컬럼
                    </span>
                  </div>
                </div>

                <div className="text-sm">
                  <Badge variant="outline" className="font-mono">
                    {formatSize(sheet.sizeBytes)}
                  </Badge>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  <div>
                    생성: {formatDistanceToNow(new Date(sheet.createdAt), { addSuffix: true, locale: ko })}
                  </div>
                  <div>
                    수정: {formatDistanceToNow(new Date(sheet.updatedAt), { addSuffix: true, locale: ko })}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={() => router.push(`/app/agents/${agent.agentId}/data-sheets/${sheet.id}`)}
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    관리
                  </Button>

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteSheet(sheet.id, sheet.name)}
                    disabled={isLoading}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    삭제
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Empty State */}
        {dataSheets.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Database className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">데이터 시트가 없습니다.</p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                첫 데이터 시트 만들기
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Data Sheet Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 데이터 시트 생성</DialogTitle>
            <DialogDescription>
              새로운 데이터 시트를 생성합니다. 기본 컬럼(id, createdAt)이 자동으로 추가됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">이름 *</Label>
              <Input
                id="name"
                placeholder="예: customers, orders"
                value={newSheetName}
                onChange={(e) => setNewSheetName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                placeholder="데이터 시트에 대한 설명을 입력하세요"
                value={newSheetDescription}
                onChange={(e) => setNewSheetDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              disabled={isLoading}
            >
              취소
            </Button>
            <Button onClick={handleCreateSheet} disabled={isLoading}>
              {isLoading ? '생성 중...' : '생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
