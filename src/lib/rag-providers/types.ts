
export type RAGProviderType =
  | 'none'
  | 'openai_vector_store'
  | 'gemini_file_search'
  | 'pinecone'
  | 'azure_ai_search'
  | 'pgvector'
  | 'http_search'
  | 'qdrant'
  | 'weaviate'
  | 'milvus'
  | 'chromadb'

export type RAGProviderCategory = 'built_in' | 'external'

export interface ConnectionSchema {
  host?: boolean
  apiKey?: boolean
  index?: boolean
  collection?: boolean
  namespace?: boolean
}

export interface EmbeddingConfig {
  provider: 'openai' | 'gemini' | 'voyage' | 'cohere' | 'local'
  model: string
  dimension?: number
}

export interface RAGProviderDefinition {
  id: RAGProviderType
  name: string
  type: RAGProviderCategory
  requiresLlmProvider?: string
  connectionSchema?: ConnectionSchema
  supportedEmbeddings: string[]
  features?: {
    metadataFiltering?: boolean
    hybridSearch?: boolean
    namespaces?: boolean
    maxFileSize?: number
  }
  docsUrl?: string
}

export interface RAGDocument {
  id: string
  content: string
  metadata?: Record<string, any>
}

export interface RAGSearchResult {
  id: string
  content: string
  score: number
  metadata?: Record<string, any>
}

export interface RAGUploadResult {
  fileId: string
  status: 'processing' | 'completed' | 'failed'
  chunkCount?: number
  pageCount?: number
  textSize?: number
  error?: string
}

export interface RAGStoreInfo {
  id: string
  name: string
  provider: RAGProviderType
  recordCount?: number
  dimension?: number
  metadata?: Record<string, any>
}
