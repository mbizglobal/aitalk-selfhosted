'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getTranslations as getAppTranslations } from '@/lib/translations/app'
import type { AppLanguage } from '@/lib/translations/app'
import { useLanguage } from '@/hooks/useLanguage'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, FileText, Database } from 'lucide-react'
import { ko, enUS, de, fr, es } from 'date-fns/locale'

// Types
import type { WorkflowListClientProps, Workflow, DataSheet, WorkflowGroup, LimitType, AddType } from './types'

// Hooks
import { useMobileDetect, useWorkflowActions, useDataSheetActions, useWorkflowGroupActions, useWorkflowStats } from './hooks'

// Components
import { WorkflowHeader, WorkflowCard, DataSheetCard, WorkflowGroupCard } from './components'
import WorkflowGroupMobile from './workflow-group-mobile'

// Dialogs
import {
  CreateWorkflowDialog, CreateDataSheetDialog, EditWorkflowDialog, CreateGroupDialog,
  LimitDialog, AddToGroupDialog, WidgetSettingsDialog, URLDialog,
} from './dialogs'

export default function WorkflowListClient({
  agent, initialWorkflows, initialDataSheets, initialWorkflowGroups = [],
  maxProductionLimit, maxWorkflowLimit, maxDataSheetLimit,
}: WorkflowListClientProps) {
  const router = useRouter()
  const { currentLanguage } = useLanguage()
  const lang = currentLanguage as AppLanguage
  const t = getAppTranslations(lang)
  const dateLocale = lang === 'ko' ? ko : lang === 'de' ? de : lang === 'fr' ? fr : lang === 'es' ? es : enUS
  const isMobile = useMobileDetect()
  const scrollRefs = useRef<{ [key: string]: HTMLDivElement | null }>({})

  // State
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkflows)
  const [dataSheets, setDataSheets] = useState<DataSheet[]>(initialDataSheets)
  const [workflowGroups, setWorkflowGroups] = useState<WorkflowGroup[]>(initialWorkflowGroups)
  const [isLoading, setIsLoading] = useState(false)

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isCreateSheetDialogOpen, setIsCreateSheetDialogOpen] = useState(false)
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false)
  const [isLimitDialogOpen, setIsLimitDialogOpen] = useState(false)
  const [isAddToGroupDialogOpen, setIsAddToGroupDialogOpen] = useState(false)
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false)

  // Selected items
  const [selectedWorkflowForEdit, setSelectedWorkflowForEdit] = useState<Workflow | null>(null)
  const [selectedWorkflowForSettings, setSelectedWorkflowForSettings] = useState<Workflow | null>(null)
  const [selectedWorkflowForUrl, setSelectedWorkflowForUrl] = useState<Workflow | null>(null)
  const [selectedGroupForAdd, setSelectedGroupForAdd] = useState<WorkflowGroup | null>(null)
  const [limitType, setLimitType] = useState<LimitType>('free')
  const [addType, setAddType] = useState<AddType>('workflow')

  // Computed values
  const stats = useWorkflowStats({ workflows, dataSheets, workflowGroups, maxWorkflowLimit, maxDataSheetLimit })

  // Hooks
  const workflowActions = useWorkflowActions({ agentId: agent.agentId, workflows, setWorkflows, workflowGroups, setWorkflowGroups, setIsLoading, setLimitType, setIsLimitDialogOpen, t })
  const dataSheetActions = useDataSheetActions({ agentId: agent.agentId, dataSheets, setDataSheets, setIsLoading, setLimitType, setIsLimitDialogOpen, t })
  const groupActions = useWorkflowGroupActions({ agentId: agent.agentId, workflowGroups, setWorkflowGroups, setIsLoading, t })

  // Handlers
  const handleEditClick = (workflowId: string) => router.push(`/app/agent-studio?workflowId=${workflowId}`)
  const handleOpenEditDialog = (workflow: Workflow) => { setSelectedWorkflowForEdit(workflow); setIsEditDialogOpen(true) }
  const handleShowSettings = (workflow: Workflow) => { setSelectedWorkflowForSettings(workflow); setIsSettingsDialogOpen(true) }
  const handleShowUrl = (workflow: Workflow) => { setSelectedWorkflowForUrl(workflow); setIsUrlDialogOpen(true) }
  const getStatusBadge = (status: string, kind?: string) => {
    if (kind === 'sub') return <Badge className="bg-pink-500 hover:bg-pink-500">Sub-workflow</Badge>
    switch (status) {
      case 'production': return <Badge className="bg-green-500">Active</Badge>
      case 'draft': return <Badge variant="secondary">Draft</Badge>
      case 'archived': return <Badge variant="outline">Archived</Badge>
      default: return <Badge>{status}</Badge>
    }
  }

  return (
    <div className={`container mx-auto px-4 py-8 max-w-7xl ${isMobile ? 'overflow-x-hidden' : ''}`}>
      <WorkflowHeader
        agent={agent} productionCount={stats.productionCount} maxProductionLimit={maxProductionLimit}
        workflowCount={stats.workflowCount} maxWorkflowLimit={maxWorkflowLimit}
        dataSheetCount={stats.dataSheetCount} maxDataSheetLimit={maxDataSheetLimit}
        isWorkflowLimitReached={stats.isWorkflowLimitReached} isDataSheetLimitReached={stats.isDataSheetLimitReached}
        isMobile={isMobile} showNewWorkflowButton={stats.ungroupedWorkflows.length === 0}
        onCreateWorkflow={() => setIsCreateDialogOpen(true)} onCreateGroup={() => setIsCreateGroupDialogOpen(true)} t={t}
      />

      {workflowGroups.map((group) => (
        isMobile ? (
          <WorkflowGroupMobile key={group.id} group={group} agentId={agent.agentId} isLoading={isLoading}
            ungroupedWorkflowsCount={stats.ungroupedWorkflows.length} ungroupedDataSheetsCount={stats.ungroupedDataSheets.length}
            onToggleExpand={groupActions.handleToggleGroupExpand} onDeleteGroup={groupActions.handleDeleteGroup}
            onAddWorkflow={(g) => { setSelectedGroupForAdd(g); setAddType('workflow'); setIsAddToGroupDialogOpen(true) }}
            onAddDataSheet={(g) => { setSelectedGroupForAdd(g); setAddType('datasheet'); setIsAddToGroupDialogOpen(true) }}
            onRemoveWorkflow={groupActions.handleRemoveWorkflowFromGroup} onRemoveDataSheet={groupActions.handleRemoveSheetFromGroup}
            onReorderWorkflows={groupActions.handleReorderWorkflows} onShowSettings={handleShowSettings} onShowUrl={handleShowUrl}
            onDownloadWorkflowJson={workflowActions.handleDownloadWorkflowJson} onDownloadSheetJson={dataSheetActions.handleDownloadSheetJson}
            onEditWorkflow={handleEditClick} onChangeStatus={workflowActions.handleChangeStatus} getStatusBadge={getStatusBadge}
            getGroupColorStyle={(c) => c === 'blue' ? 'from-blue-500/10 to-purple-500/10 border-blue-500/30' : c === 'green' ? 'from-green-500/10 to-emerald-500/10 border-green-500/30' : c === 'orange' ? 'from-orange-500/10 to-amber-500/10 border-orange-500/30' : c === 'red' ? 'from-red-500/10 to-pink-500/10 border-red-500/30' : 'from-purple-500/10 to-violet-500/10 border-purple-500/30'}
            getGroupIconColor={(c) => c === 'blue' ? 'bg-blue-500/20 text-blue-400' : c === 'green' ? 'bg-green-500/20 text-green-400' : c === 'orange' ? 'bg-orange-500/20 text-orange-400' : c === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-purple-500/20 text-purple-400'}
            t={t}
          />
        ) : (
          <WorkflowGroupCard key={group.id} group={group} agentId={agent.agentId} isLoading={isLoading}
            ungroupedWorkflowsCount={stats.ungroupedWorkflows.length} ungroupedDataSheetsCount={stats.ungroupedDataSheets.length}
            scrollRefs={scrollRefs} onToggleExpand={groupActions.handleToggleGroupExpand} onDeleteGroup={groupActions.handleDeleteGroup}
            onAddWorkflow={(g) => { setSelectedGroupForAdd(g); setAddType('workflow'); setIsAddToGroupDialogOpen(true) }}
            onAddDataSheet={(g) => { setSelectedGroupForAdd(g); setAddType('datasheet'); setIsAddToGroupDialogOpen(true) }}
            onRemoveWorkflow={groupActions.handleRemoveWorkflowFromGroup} onRemoveDataSheet={groupActions.handleRemoveSheetFromGroup}
            onDragEnd={groupActions.handleDragEnd} onHorizontalScroll={(e, id) => { const c = scrollRefs.current[id]; if (c) { e.preventDefault(); c.scrollLeft += e.deltaY } }}
            onEditWorkflow={handleEditClick} onShowSettings={handleShowSettings} onShowUrl={handleShowUrl}
            onDownloadWorkflowJson={workflowActions.handleDownloadWorkflowJson} onDownloadSheetJson={dataSheetActions.handleDownloadSheetJson}
            onChangeStatus={workflowActions.handleChangeStatus} getStatusBadge={getStatusBadge} t={t}
          />
        )
      ))}

      {stats.ungroupedWorkflows.length > 0 && (
        <>
          <div className={`mb-${isMobile ? '3' : '4'} mt-${isMobile ? '6' : '8'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold flex items-center gap-2`}>
                <FileText className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-muted-foreground flex-shrink-0`} />
                <span className={isMobile ? 'truncate' : ''}>{t.workflow_ungrouped_workflows}</span>
              </h2>
              {!stats.isWorkflowLimitReached && (
                <Button size={isMobile ? 'sm' : 'default'} onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4" />{!isMobile && <span className="ml-2">{t.workflow_new_workflow}</span>}
                </Button>
              )}
            </div>
          </div>
          <div className={isMobile ? 'flex flex-col gap-2 mb-6' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8'}>
            {stats.ungroupedWorkflows.map((workflow) => (
              <WorkflowCard key={workflow.workflowId} workflow={workflow} dateLocale={dateLocale} isLoading={isLoading} isMobile={isMobile}
                onEdit={handleEditClick} onOpenEditDialog={handleOpenEditDialog} onSettings={handleShowSettings}
                onDownload={workflowActions.handleDownloadWorkflowJson} onClone={workflowActions.handleCloneWorkflow}
                onDelete={workflowActions.handleDeleteWorkflow} onChangeStatus={workflowActions.handleChangeStatus}
                onShowUrl={handleShowUrl} getStatusBadge={getStatusBadge} t={t}
              />
            ))}
          </div>
        </>
      )}

      {workflows.length === 0 && workflowGroups.length === 0 && (
        <Card className="mb-8">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">{t.workflow_empty_state}</p>
            <Button onClick={() => setIsCreateDialogOpen(true)}><Plus className="w-4 h-4 mr-2" />{t.workflow_create_first}</Button>
          </CardContent>
        </Card>
      )}

      <div className={`mb-${isMobile ? '3' : '6'} mt-${isMobile ? '6' : '12'}`}>
        <div className="flex items-center justify-between">
          <h2 className={`${isMobile ? 'text-base' : 'text-xl'} font-bold flex items-center gap-2`}>
            <Database className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'} text-muted-foreground flex-shrink-0`} />
            <span className={isMobile ? 'truncate' : ''}>{stats.ungroupedDataSheets.length > 0 ? t.workflow_ungrouped_sheets : t.datasheet_title}</span>
          </h2>
          {!stats.isDataSheetLimitReached && (
            <Button size={isMobile ? 'sm' : 'default'} onClick={() => setIsCreateSheetDialogOpen(true)}>
              <Plus className="w-4 h-4" />{!isMobile && <span className="ml-2">{t.datasheet_new}</span>}
            </Button>
          )}
        </div>
      </div>
      {stats.ungroupedDataSheets.length > 0 && (
        <div className={isMobile ? 'flex flex-col gap-2' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}>
          {stats.ungroupedDataSheets.map((sheet) => (
            <DataSheetCard key={sheet.id} sheet={sheet} agentId={agent.agentId} dateLocale={dateLocale} isLoading={isLoading} isMobile={isMobile}
              onDownload={dataSheetActions.handleDownloadSheetJson} onDelete={dataSheetActions.handleDeleteSheet} t={t}
            />
          ))}
        </div>
      )}

      <CreateWorkflowDialog isOpen={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} isLoading={isLoading}
        onCreate={(name, desc, workflowJson, dataSheetSchema, kind, bundleTemplateId) => workflowActions.handleCreateWorkflow(name, desc, () => setIsCreateDialogOpen(false), workflowJson, dataSheetSchema, kind, bundleTemplateId)} t={t} />
      <CreateDataSheetDialog isOpen={isCreateSheetDialogOpen} onOpenChange={setIsCreateSheetDialogOpen} isLoading={isLoading}
        onCreate={(name, desc) => dataSheetActions.handleCreateSheet(name, desc, () => setIsCreateSheetDialogOpen(false))} t={t} />
      <EditWorkflowDialog isOpen={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} workflow={selectedWorkflowForEdit} isLoading={isLoading}
        onUpdate={(id, name, desc) => workflowActions.handleUpdateWorkflow(id, name, desc, () => { setIsEditDialogOpen(false); setSelectedWorkflowForEdit(null) })} t={t} />
      <CreateGroupDialog isOpen={isCreateGroupDialogOpen} onOpenChange={setIsCreateGroupDialogOpen} isLoading={isLoading}
        onCreate={(name, desc, color) => groupActions.handleCreateGroup(name, desc, color, () => setIsCreateGroupDialogOpen(false))} t={t} />
      <LimitDialog isOpen={isLimitDialogOpen} onOpenChange={setIsLimitDialogOpen} limitType={limitType} t={t} />
      <AddToGroupDialog isOpen={isAddToGroupDialogOpen} onOpenChange={setIsAddToGroupDialogOpen} addType={addType} selectedGroup={selectedGroupForAdd}
        ungroupedWorkflows={stats.ungroupedWorkflows} ungroupedDataSheets={stats.ungroupedDataSheets}
        onAddWorkflow={(gId, wId) => groupActions.handleAddWorkflowToGroup(gId, wId, () => setIsAddToGroupDialogOpen(false))}
        onAddSheet={(gId, sId) => groupActions.handleAddSheetToGroup(gId, sId, () => setIsAddToGroupDialogOpen(false))}
        getStatusBadge={getStatusBadge} t={t} />
      <WidgetSettingsDialog isOpen={isSettingsDialogOpen} onOpenChange={setIsSettingsDialogOpen} workflow={selectedWorkflowForSettings} agent={agent} t={t} />
      <URLDialog isOpen={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen} workflow={selectedWorkflowForUrl}
        agentId={agent.agentId} accessMode={agent.accessMode || 'public'} t={t} />
    </div>
  )
}
