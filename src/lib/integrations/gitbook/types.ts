
// =============================================================================
// =============================================================================

export interface GitBookSpace {
  id: string
  title: string
  visibility: 'public' | 'private' | 'unlisted'
  urls: {
    app: string
    published?: string
  }
  createdAt: string
  updatedAt: string
}

// =============================================================================
// =============================================================================

export interface GitBookPage {
  id: string
  title: string
  kind: 'document' | 'link' | 'group'
  type: 'document' | 'link' | 'group'
  path: string
  slug: string           // URL slug
  description?: string
  pages?: GitBookPage[]
}

export interface GitBookPageContent {
  id: string
  title: string
  kind: 'document' | 'link' | 'group'
  type: 'document' | 'link' | 'group'
  path: string
  slug: string
  description?: string
  document?: GitBookDocument
  pages?: GitBookPage[]
}

// =============================================================================
// =============================================================================

export interface GitBookDocument {
  nodes: GitBookDocumentNode[]
}

export interface GitBookDocumentNode {
  type: string           // 'paragraph', 'heading-1', 'heading-2', 'list-item', 'code-block', etc.
  object?: 'block' | 'inline' | 'text'
  data?: Record<string, any>
  nodes?: GitBookDocumentNode[]
  leaves?: GitBookTextLeaf[]
}

export interface GitBookTextLeaf {
  object: 'leaf'
  text: string
  marks?: GitBookMark[]
}

export interface GitBookMark {
  type: 'bold' | 'italic' | 'code' | 'strikethrough'
}

// =============================================================================
// =============================================================================

export interface GitBookSpaceContent {
  pages: GitBookPage[]
  files?: GitBookFile[]
}

export interface GitBookFile {
  id: string
  name: string
  downloadURL: string
  contentType?: string
  size?: number
  dimensions?: {
    width: number
    height: number
  }
}

// =============================================================================
// =============================================================================

export interface GitBookSearchResult {
  id: string
  title: string
  path: string
  body?: string
  urls: {
    app: string
  }
}

export interface GitBookSearchResponse {
  items: GitBookSearchResult[]
  next?: {
    page: string
  }
}

// =============================================================================
// =============================================================================

export interface GitBookListResponse<T> {
  items: T[]
  next?: {
    page: string
  }
}

// =============================================================================
// =============================================================================

export interface GitBookClientConfig {
  accessToken: string
  baseUrl?: string
}

// =============================================================================
// =============================================================================

export interface GitBookImportOptions {
  spaceId: string
  pagePaths?: string[]
  includeSubpages?: boolean
}

export interface GitBookImportResult {
  success: boolean
  pagesImported: number
  errors?: string[]
}

// =============================================================================
// =============================================================================

export interface GitBookRAGMetadata {
  source: 'gitbook'
  spaceId: string
  pageId: string
  pagePath: string
  pageTitle: string
  pageUrl: string
  chunkIndex?: number
  totalChunks?: number
  importedAt: string
}

// =============================================================================
// =============================================================================

export interface PageContext {
  url: string
  path: string           // pathname
  title: string          // document.title
  hostname?: string      // hostname
}
