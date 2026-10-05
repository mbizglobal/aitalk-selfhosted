
import { useState, useEffect, useCallback } from 'react'
import { RAGProviderType } from '@/lib/rag-providers/types'

const RAG_TO_LLM_PROVIDER: Record<string, string> = {
  openai_vector_store: 'openai',
  gemini_file_search: 'gemini',
  pinecone: 'pinecone',
}

export const SUPPORTED_RAG_PROVIDERS: Array<{
  id: RAGProviderType
  name: string
  description: string
  iconType: 'openai' | 'gemini' | 'pinecone'
  llmProvider: string
  available: boolean
  docsUrl: string
}> = [
  {
    id: 'openai_vector_store',
    name: 'OpenAI Vector Store',
    description: 'Built-in vector store by OpenAI',
    iconType: 'openai',
    llmProvider: 'openai',
    available: true,
    docsUrl: 'https://platform.openai.com/docs/assistants/tools/file-search',
  },
  {
    id: 'gemini_file_search',
    name: 'Gemini File Search',
    description: 'Google Gemini file search',
    iconType: 'gemini',
    llmProvider: 'gemini',
    available: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/files',
  },
  {
    id: 'pinecone',
    name: 'Pinecone',
    description: 'High-performance vector database',
    iconType: 'pinecone',
    llmProvider: 'pinecone',
    available: false,  // Coming Soon
    docsUrl: 'https://docs.pinecone.io',
  },
]

export interface DocPagesInfo {
  used: number
  limit: number | null
}

interface UseRagProviderReturn {
  selectedProvider: RAGProviderType
  hasApiKey: boolean | null
  isLoading: boolean
  configuredProviders: string[]

  providerInfo: typeof SUPPORTED_RAG_PROVIDERS[0] | undefined
  requiredLlmProvider: string

  docPages: DocPagesInfo | null

  refresh: () => Promise<void>
}

export function useRagProvider(): UseRagProviderReturn {
  const [selectedProvider, setSelectedProvider] = useState<RAGProviderType>('openai_vector_store')
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([])
  const [docPages, setDocPages] = useState<DocPagesInfo | null>(null)

  const providerInfo = SUPPORTED_RAG_PROVIDERS.find(p => p.id === selectedProvider)
  const requiredLlmProvider = RAG_TO_LLM_PROVIDER[selectedProvider] || 'openai'

  const fetchRagProvider = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/storage/rag-provider')

      if (response.ok) {
        const data = await response.json()
        setSelectedProvider(data.defaultProvider || 'openai_vector_store')
        setHasApiKey(data.hasApiKey)
        setConfiguredProviders(data.configuredProviders || [])
        setDocPages(data.docPages || null)
      } else {
        setSelectedProvider('openai_vector_store')
        setHasApiKey(false)
        setConfiguredProviders([])
        setDocPages(null)
      }
    } catch (error) {
      console.error('Failed to fetch RAG provider:', error)
      setSelectedProvider('openai_vector_store')
      setHasApiKey(false)
      setConfiguredProviders([])
      setDocPages(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRagProvider()
  }, [fetchRagProvider])

  return {
    selectedProvider,
    hasApiKey,
    isLoading,
    configuredProviders,
    providerInfo,
    requiredLlmProvider,
    docPages,
    refresh: fetchRagProvider,
  }
}

export function isProviderConfigured(
  provider: RAGProviderType,
  configuredProviders: string[]
): boolean {
  const llmProvider = RAG_TO_LLM_PROVIDER[provider]
  return configuredProviders.includes(llmProvider)
}

export function getSupportedFileTypes(provider: RAGProviderType): string[] {
  switch (provider) {
    case 'openai_vector_store':
      return ['.doc', '.docx', '.json', '.md', '.pdf', '.pptx', '.tex', '.txt']
    case 'gemini_file_search':
      return ['.doc', '.docx', '.json', '.md', '.pdf', '.pptx', '.txt', '.csv', '.html', '.xml']
    case 'azure_ai_search':
      return ['.txt', '.md', '.json', '.tex', '.pdf', '.docx', '.pptx', '.xlsx', '.jpg', '.png']
    case 'pinecone':
      return ['.txt', '.md', '.json']
    default:
      return ['.txt', '.md', '.json']
  }
}

export function getMaxFileSize(provider: RAGProviderType): number {
  return 20 * 1024 * 1024  // 20MB
}
