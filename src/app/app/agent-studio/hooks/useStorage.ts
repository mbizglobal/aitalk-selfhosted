
import { useState, useEffect, useCallback } from 'react'
import type { StorageStats } from '../types'

type RAGProviderType = 'openai_vector_store' | 'gemini_file_search' | 'pinecone'

export function useStorage(agentId: string | null, ragProvider?: RAGProviderType) {
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])
  const [loadingStorage, setLoadingStorage] = useState(false)

  const loadStorageStats = async () => {
    if (!agentId) return

    setLoadingStorage(true)
    try {
      const response = await fetch(`/api/storage/${agentId}/stats`)
      if (response.ok) {
        const stats = await response.json()
        setStorageStats(stats)
      }
    } catch (error) {
      console.error('Failed to load storage stats:', error)
    } finally {
      setLoadingStorage(false)
    }
  }

  const checkApiKey = useCallback(async (provider?: RAGProviderType) => {
    try {
      const targetProvider = provider || ragProvider || 'openai_vector_store'
      const response = await fetch(`/api/storage/check-api-key?ragProvider=${targetProvider}`)
      if (response.ok) {
        const data = await response.json()
        setHasApiKey(data.hasApiKey)
        setConfiguredProviders(data.configuredProviders || [])
      }
    } catch (error) {
      console.error('Failed to check API key:', error)
      setHasApiKey(false)
      setConfiguredProviders([])
    }
  }, [ragProvider])

  const deleteStorageItem = async (itemId: string) => {
    if (!agentId) return false

    try {
      const response = await fetch(`/api/storage/${agentId}/${itemId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await loadStorageStats()
        return true
      }
      return false
    } catch (error) {
      console.error('Failed to delete storage item:', error)
      return false
    }
  }

  useEffect(() => {
    if (agentId) {
      loadStorageStats()
    }
  }, [agentId])

  useEffect(() => {
    checkApiKey(ragProvider)
  }, [ragProvider, checkApiKey])

  return {
    // State
    storageStats,
    hasApiKey,
    configuredProviders,
    loadingStorage,

    // Functions
    loadStorageStats,
    checkApiKey,
    deleteStorageItem
  }
}