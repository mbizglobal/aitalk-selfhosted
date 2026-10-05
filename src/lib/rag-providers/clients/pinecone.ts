import { BaseRAGClient } from '@/lib/rag-providers/clients/base'
import type { RAGDocument, RAGSearchResult, RAGUploadResult, RAGStoreInfo } from '@/lib/rag-providers/types'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export interface PineconeConnectionConfig {
  host?: string
  indexName: string
  namespace?: string
  embeddingApiKey?: string
  embeddingModel?: string
  dimension?: number
}
export class PineconeClient extends BaseRAGClient {
  constructor(apiKey: string, _connectionConfig: PineconeConnectionConfig) { super(apiKey, 'pinecone') }
  createStore(_name: string): Promise<RAGStoreInfo> { return unavailable('Pinecone') }
  deleteStore(_storeId: string): Promise<void> { return unavailable('Pinecone') }
  getStoreInfo(_storeId: string): Promise<RAGStoreInfo> { return unavailable('Pinecone') }
  uploadFile(_storeId: string, _file: Buffer | Blob, _fileName: string, _mimeType?: string): Promise<RAGUploadResult> { return unavailable('Pinecone') }
  deleteFile(_storeId: string, _fileId: string): Promise<void> { return unavailable('Pinecone') }
  search(_storeId: string, _query: string, _topK?: number, _filter?: Record<string, any>): Promise<RAGSearchResult[]> { return unavailable('Pinecone') }
  validateConnection(): Promise<boolean> { return unavailable('Pinecone') }
  upsertDocuments(_storeId: string, _documents: RAGDocument[]): Promise<void> { return unavailable('Pinecone') }
  deleteDocuments(_storeId: string, _ids: string[]): Promise<void> { return unavailable('Pinecone') }
}
