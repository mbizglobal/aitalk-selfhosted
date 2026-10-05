import { useState, useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

export interface RagSpace {
  id: number
  name: string
  isDefault: boolean
  sortOrder: number
  itemCount?: number
}

interface UseRagSpacesReturn {
  spaces: RagSpace[]
  managed: boolean
  max: number
  loading: boolean
  ready: boolean
  selectedSpaceId: number | null
  setSelectedSpaceId: (id: number | null) => void
  createSpace: (name: string) => Promise<boolean>
  renameSpace: (id: number, name: string) => Promise<boolean>
  deleteSpace: (id: number) => Promise<boolean>
  reload: () => Promise<void>
}

function lsKey(agentId: string) {
  return `ragSpace_${agentId}`
}

export function useRagSpaces(
  currentAgentId: string | null,
  t: (key: string) => string
): UseRagSpacesReturn {
  const [spaces, setSpaces] = useState<RagSpace[]>([])
  const [managed, setManaged] = useState(false)
  const [max, setMax] = useState(5)
  const [loading, setLoading] = useState(true)
  const [loadedAgentId, setLoadedAgentId] = useState<string | null>(null)
  const [selectedSpaceId, setSelectedSpaceIdState] = useState<number | null>(null)
  const reqRef = useRef(0)

  const setSelectedSpaceId = useCallback((id: number | null) => {
    setSelectedSpaceIdState(id)
    if (currentAgentId && id != null) {
      try { localStorage.setItem(lsKey(currentAgentId), String(id)) } catch {}
    }
  }, [currentAgentId])

  const reload = useCallback(async () => {
    if (!currentAgentId) {
      setSpaces([]); setManaged(false); setSelectedSpaceIdState(null); setLoading(false); setLoadedAgentId(null)
      return
    }
    const token = ++reqRef.current
    setLoading(true)
    try {
      const res = await fetch(`/api/storage/spaces?agentId=${currentAgentId}`)
      const data = await res.json()
      if (token !== reqRef.current) return
      const list: RagSpace[] = data.spaces || []
      setSpaces(list)
      setManaged(!!data.managed)
      setMax(data.max || 5)

      setSelectedSpaceIdState(prev => {
        if (prev != null && list.some(s => s.id === prev)) return prev
        const stored = (() => { try { return Number(localStorage.getItem(lsKey(currentAgentId))) } catch { return NaN } })()
        return list.find(s => s.id === stored)?.id ?? data.defaultSpaceId ?? list[0]?.id ?? null
      })
      setLoadedAgentId(currentAgentId)
    } catch (e) {
      if (token !== reqRef.current) return
      console.error('[useRagSpaces] load failed:', e)
    } finally {
      if (token === reqRef.current) setLoading(false)
    }
  }, [currentAgentId])

  useEffect(() => {
    setLoading(true)
    setSpaces([]); setManaged(false); setSelectedSpaceIdState(null); setLoadedAgentId(null)
    reqRef.current++
  }, [currentAgentId])

  useEffect(() => { reload() }, [reload])

  const ready = loadedAgentId === currentAgentId

  const createSpace = useCallback(async (name: string): Promise<boolean> => {
    if (!currentAgentId) return false
    try {
      const res = await fetch('/api/storage/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: currentAgentId, name }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.code === 'RAG_SPACE_LIMIT_EXCEEDED' ? t('rag_space_limit_reached')
          : data.code === 'RAG_SPACE_NAME_DUP' ? t('rag_space_name_dup')
          : data.code === 'RAG_SPACE_NAME_RESERVED' ? t('rag_space_name_reserved')
          : (data.error || t('rag_space_create_failed')))
        return false
      }
      toast.success(t('rag_space_create_success'))
      await reload()
      if (data.space?.id) setSelectedSpaceId(data.space.id)
      return true
    } catch (e) {
      console.error('[useRagSpaces] create failed:', e)
      toast.error(t('rag_space_create_failed'))
      return false
    }
  }, [currentAgentId, t, reload, setSelectedSpaceId])

  const renameSpace = useCallback(async (id: number, name: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/storage/spaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.code === 'RAG_SPACE_NAME_DUP' ? t('rag_space_name_dup')
          : data.code === 'RAG_SPACE_NAME_RESERVED' ? t('rag_space_name_reserved')
          : (data.error || t('rag_space_rename_failed')))
        return false
      }
      toast.success(t('rag_space_rename_success'))
      await reload()
      return true
    } catch (e) {
      console.error('[useRagSpaces] rename failed:', e)
      toast.error(t('rag_space_rename_failed'))
      return false
    }
  }, [t, reload])

  const deleteSpace = useCallback(async (id: number): Promise<boolean> => {
    try {
      const res = await fetch(`/api/storage/spaces/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || t('rag_space_delete_failed'))
        return false
      }
      toast.success(t('rag_space_delete_success'))
      if (selectedSpaceId === id) {
        const def = spaces.find(s => s.isDefault)
        setSelectedSpaceId(def?.id ?? null)
      }
      await reload()
      return true
    } catch (e) {
      console.error('[useRagSpaces] delete failed:', e)
      toast.error(t('rag_space_delete_failed'))
      return false
    }
  }, [t, reload, selectedSpaceId, spaces, setSelectedSpaceId])

  return {
    spaces, managed, max, loading, ready,
    selectedSpaceId, setSelectedSpaceId,
    createSpace, renameSpace, deleteSpace, reload,
  }
}
