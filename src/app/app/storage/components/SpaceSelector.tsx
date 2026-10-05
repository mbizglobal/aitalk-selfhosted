'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, MoreVertical, Pencil, Trash2, Layers } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import type { RagSpace } from '../hooks/useRagSpaces'

interface SpaceSelectorProps {
  spaces: RagSpace[]
  max: number
  selectedSpaceId: number | null
  onSelect: (id: number) => void
  onCreate: (name: string) => Promise<boolean>
  onRename: (id: number, name: string) => Promise<boolean>
  onDelete: (id: number) => Promise<boolean>
  t: (key: string) => string
}

export function SpaceSelector({
  spaces, max, selectedSpaceId, onSelect, onCreate, onRename, onDelete, t,
}: SpaceSelectorProps) {
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [renameTarget, setRenameTarget] = useState<RagSpace | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RagSpace | null>(null)
  const [busy, setBusy] = useState(false)

  const canAdd = spaces.length < max

  const openCreate = () => { setDialogMode('create'); setNameInput('') }
  const openRename = (s: RagSpace) => { setDialogMode('rename'); setRenameTarget(s); setNameInput(s.name) }

  const submitDialog = async () => {
    if (busy) return
    const name = nameInput.trim()
    if (!name) return
    setBusy(true)
    const ok = dialogMode === 'create'
      ? await onCreate(name)
      : renameTarget ? await onRename(renameTarget.id, name) : false
    setBusy(false)
    if (ok) { setDialogMode(null); setRenameTarget(null); setNameInput('') }
  }

  const confirmDelete = async () => {
    if (busy || !deleteTarget) return
    setBusy(true)
    const ok = await onDelete(deleteTarget.id)
    setBusy(false)
    if (ok) setDeleteTarget(null)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm text-muted-foreground shrink-0 mr-1">{t('rag_space_label')}</span>

      {spaces.map((s) => {
        const isSel = s.id === selectedSpaceId
        const label = s.isDefault ? t('rag_space_default') : s.name
        return (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={cn(
              'group h-9 pl-3.5 pr-2.5 rounded-md border text-sm font-medium flex items-center gap-2 shrink-0 cursor-pointer transition-colors select-none',
              isSel
                ? 'bg-blue-500/10 border-blue-500/60 text-foreground'
                : 'bg-transparent border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40',
            )}
          >
            <span className="truncate max-w-[140px]">{label}</span>
            {typeof s.itemCount === 'number' && (
              <span
                title={`${t('storage_stats_total_items')}: ${s.itemCount}`}
                className={cn(
                  'inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full text-xs font-medium',
                  isSel ? 'bg-blue-500/20 text-blue-100' : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {s.itemCount}
              </span>
            )}
            {isSel && !s.isDefault && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openRename(s)}>
                    <Pencil className="h-4 w-4 mr-2" /> {t('rag_space_rename')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(s)}>
                    <Trash2 className="h-4 w-4 mr-2" /> {t('rag_space_delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <Button
        variant="ghost" size="sm"
        className="h-9 px-3 border border-dashed border-foreground/25 text-muted-foreground hover:text-foreground hover:border-foreground/40 shrink-0"
        disabled={!canAdd || busy}
        onClick={openCreate}
        title={canAdd ? t('rag_space_add') : t('rag_space_limit_reached')}
      >
        <Plus className="h-4 w-4 mr-1" /> {t('rag_space_add')}
      </Button>
      {!canAdd && (
        <span className="text-xs text-muted-foreground">{t('rag_space_limit_reached')}</span>
      )}

      <Dialog open={dialogMode !== null} onOpenChange={(o) => { if (!o) { setDialogMode(null); setRenameTarget(null) } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'create' ? t('rag_space_create_title') : t('rag_space_rename_title')}</DialogTitle>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t('rag_space_name_placeholder')}
            maxLength={100}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Enter') submitDialog() }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogMode(null); setRenameTarget(null) }}>{t('cancel')}</Button>
            <Button onClick={submitDialog} disabled={busy || !nameInput.trim()}>{t('rag_space_save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rag_space_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('rag_space_delete_confirm').replace('{name}', deleteTarget?.name || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => { e.preventDefault(); confirmDelete() }}
            >
              {t('rag_space_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
