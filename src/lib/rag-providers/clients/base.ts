
import {
  RAGProviderType,
  RAGDocument,
  RAGSearchResult,
  RAGUploadResult,
  RAGStoreInfo,
} from '../types'

export abstract class BaseRAGClient {
  protected apiKey: string
  protected providerId: RAGProviderType

  constructor(apiKey: string, providerId: RAGProviderType) {
    this.apiKey = apiKey
    this.providerId = providerId
  }

  abstract createStore(name: string): Promise<RAGStoreInfo>

  abstract deleteStore(storeId: string): Promise<void>

  abstract getStoreInfo(storeId: string): Promise<RAGStoreInfo>

  abstract uploadFile(
    storeId: string,
    file: Buffer | Blob,
    fileName: string,
    mimeType?: string
  ): Promise<RAGUploadResult>

  abstract deleteFile(storeId: string, fileId: string): Promise<void>

  abstract search(
    storeId: string,
    query: string,
    topK?: number
  ): Promise<RAGSearchResult[]>

  abstract validateConnection(): Promise<boolean>

  getProviderId(): RAGProviderType {
    return this.providerId
  }
}
