import { BaseRAGClient } from '@/lib/rag-providers/clients/base'
import type { RAGSearchResult, RAGUploadResult, RAGStoreInfo } from '@/lib/rag-providers/types'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export class OpenAIVectorStoreClient extends BaseRAGClient {
  constructor(apiKey: string) { super(apiKey, 'openai_vector_store') }
  createStore(_name: string): Promise<RAGStoreInfo> { return unavailable('OpenAI Vector Store') }
  deleteStore(_storeId: string): Promise<void> { return unavailable('OpenAI Vector Store') }
  getStoreInfo(_storeId: string): Promise<RAGStoreInfo> { return unavailable('OpenAI Vector Store') }
  uploadFile(_storeId: string, _file: Buffer | Blob, _fileName: string, _mimeType?: string): Promise<RAGUploadResult> { return unavailable('OpenAI Vector Store') }
  deleteFile(_storeId: string, _fileId: string): Promise<void> { return unavailable('OpenAI Vector Store') }
  search(_storeId: string, _query: string, _topK?: number): Promise<RAGSearchResult[]> { return unavailable('OpenAI Vector Store') }
  validateConnection(): Promise<boolean> { return unavailable('OpenAI Vector Store') }
  listFiles(_storeId: string): Promise<any[]> { return unavailable('OpenAI Vector Store') }
}
