
import { BaseRAGClient } from './clients/base'
import { OpenAIVectorStoreClient } from './clients/openai-vector-store'
import { GeminiFileSearchClient } from './clients/gemini-file-search'
import { PineconeClient, PineconeConnectionConfig } from './clients/pinecone'
import { AzureAISearchClient, AzureAISearchConfig } from './clients/azure-ai-search'
import { RAGProviderType } from './types'

export interface PineconeDBConfig {
  apiKey?: string
  indexName?: string
  namespace?: string
}

export function createRAGClient(
  provider: RAGProviderType,
  apiKey: string,
  connectionConfig?: Record<string, any>
): BaseRAGClient {
  switch (provider) {
    case 'openai_vector_store':
      return new OpenAIVectorStoreClient(apiKey)

    case 'gemini_file_search':
      return new GeminiFileSearchClient(apiKey)

    case 'pinecone':
      if (!connectionConfig?.indexName) {
        throw new Error('Pinecone requires indexName in connectionConfig')
      }
      return new PineconeClient(apiKey, connectionConfig as PineconeConnectionConfig)

    case 'azure_ai_search':
      if (!connectionConfig?.searchEndpoint || !connectionConfig?.openaiEndpoint) {
        throw new Error('Azure AI Search requires searchEndpoint and openaiEndpoint in connectionConfig')
      }
      return new AzureAISearchClient(connectionConfig as AzureAISearchConfig)

    case 'qdrant':
      throw new Error('Qdrant client not implemented yet')

    case 'weaviate':
      throw new Error('Weaviate client not implemented yet')

    case 'milvus':
      throw new Error('Milvus client not implemented yet')

    case 'chromadb':
      throw new Error('ChromaDB client not implemented yet')

    default:
      throw new Error(`Unknown RAG provider: ${provider}`)
  }
}

export async function validateRAGConnection(
  provider: RAGProviderType,
  apiKey: string,
  connectionConfig?: Record<string, any>
): Promise<boolean> {
  try {
    const client = createRAGClient(provider, apiKey, connectionConfig)
    return await client.validateConnection()
  } catch {
    return false
  }
}
