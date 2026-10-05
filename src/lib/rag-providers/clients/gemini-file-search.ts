import { BaseRAGClient } from '@/lib/rag-providers/clients/base'
import type { RAGSearchResult, RAGUploadResult, RAGStoreInfo } from '@/lib/rag-providers/types'

const unavailable = (what: string): never => { throw new Error(`${what} is not part of this installation (self-hosted edition)`) }

export class GeminiFileSearchClient extends BaseRAGClient {
  constructor(apiKey: string) { super(apiKey, 'gemini_file_search') }
  createStore(_name: string): Promise<RAGStoreInfo> { return unavailable('Gemini File Search') }
  deleteStore(_storeId: string): Promise<void> { return unavailable('Gemini File Search') }
  getStoreInfo(_storeId: string): Promise<RAGStoreInfo> { return unavailable('Gemini File Search') }
  uploadFile(_storeId: string, _file: Buffer | Blob, _fileName: string, _mimeType?: string): Promise<RAGUploadResult> { return unavailable('Gemini File Search') }
  deleteFile(_storeId: string, _fileId: string): Promise<void> { return unavailable('Gemini File Search') }
  search(_storeId: string, _query: string, _topK?: number): Promise<RAGSearchResult[]> { return unavailable('Gemini File Search') }
  validateConnection(): Promise<boolean> { return unavailable('Gemini File Search') }
  listFiles(): Promise<any[]> { return unavailable('Gemini File Search') }
  getFileInfo(_fileId: string): Promise<any> { return unavailable('Gemini File Search') }
  createFileReference(_fileUri: string): any { return unavailable('Gemini File Search') }
}
