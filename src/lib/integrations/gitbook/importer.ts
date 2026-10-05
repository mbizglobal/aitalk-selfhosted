
import { GitBookClient } from './client'
import {
  GitBookPage,
  GitBookPageContent,
  GitBookImportOptions,
  GitBookImportResult,
  GitBookRAGMetadata,
} from './types'

export interface ImporterConfig {
  accessToken: string
  publishedBaseUrl?: string
}

export interface RAGDocumentForImport {
  id: string
  content: string
  metadata: GitBookRAGMetadata
}

export interface ImportContext {
  pageIdToPath: Map<string, string>
  fileIdToUrl: Map<string, string>
}

export class GitBookImporter {
  private client: GitBookClient
  private publishedBaseUrl?: string

  constructor(config: ImporterConfig) {
    this.client = new GitBookClient({ accessToken: config.accessToken })
    this.publishedBaseUrl = config.publishedBaseUrl
  }

  async prepareContext(spaceId: string): Promise<ImportContext> {
    const allPages = await this.client.getAllPagesFlat(spaceId)
    const pageIdToPath = new Map<string, string>()
    for (const p of allPages) {
      if (p.id && p.path) {
        pageIdToPath.set(p.id, p.path)
      }
    }
    const fileIdToUrl = await this.client.getFileIdToUrlMap(spaceId)
    return { pageIdToPath, fileIdToUrl }
  }

  async importSinglePage(
    spaceId: string,
    pagePath: string,
    context: ImportContext
  ): Promise<RAGDocumentForImport | null> {
    const pageContent = await this.client.getPageByPath(spaceId, pagePath)

    if (pageContent.kind !== 'document' && pageContent.type !== 'document') {
      return null
    }

    const markdown = this.client.documentToMarkdown(pageContent, {
      publishedBaseUrl: this.publishedBaseUrl,
      spaceId,
      pageIdToPath: context.pageIdToPath,
      fileIdToUrl: context.fileIdToUrl,
    })

    if (!markdown || markdown.trim().length === 0) {
      return null
    }

    const docId = this.generateDocumentId(spaceId, pagePath)
    const pageUrl = this.publishedBaseUrl
      ? GitBookClient.buildPublishedUrl(this.publishedBaseUrl, pagePath)
      : `https://app.gitbook.com/s/${spaceId}/${pagePath}`

    const metadata: GitBookRAGMetadata = {
      source: 'gitbook',
      spaceId,
      pageId: pageContent.id || '',
      pagePath: pageContent.path || pagePath,
      pageTitle: pageContent.title || pagePath.split('/').pop() || pagePath,
      pageUrl,
      importedAt: new Date().toISOString(),
    }

    return {
      id: docId,
      content: this.formatContentWithMetadata(markdown, metadata),
      metadata,
    }
  }

  async importPages(options: GitBookImportOptions): Promise<{
    documents: RAGDocumentForImport[]
    result: GitBookImportResult
  }> {
    const { spaceId, pagePaths, includeSubpages = true } = options
    const documents: RAGDocumentForImport[] = []
    const errors: string[] = []

    try {
      const allPages = await this.client.getAllPagesFlat(spaceId)
      const pageIdToPath = new Map<string, string>()
      for (const p of allPages) {
        if (p.id && p.path) {
          pageIdToPath.set(p.id, p.path)
        }
      }

      const fileIdToUrl = await this.client.getFileIdToUrlMap(spaceId)

      let pages: GitBookPage[]

      if (pagePaths && pagePaths.length > 0) {
        pages = []
        for (const path of pagePaths) {
          try {
            const page = await this.client.getPageByPath(spaceId, path)
            pages.push({
              id: page.id,
              title: page.title,
              kind: page.kind,
              type: page.type,
              path: page.path,
              slug: page.slug,
              pages: includeSubpages ? page.pages : undefined,
            })
          } catch (err: any) {
            errors.push(`Failed to fetch page "${path}": ${err.message}`)
          }
        }
      } else {
        pages = allPages
      }

      for (const page of pages) {
        try {
          const doc = await this.convertPageToDocument(spaceId, page, pageIdToPath, fileIdToUrl)
          if (doc) {
            documents.push(doc)
          }
        } catch (err: any) {
          errors.push(`Failed to convert page "${page.path}": ${err.message}`)
        }
      }

      return {
        documents,
        result: {
          success: errors.length === 0,
          pagesImported: documents.length,
          errors: errors.length > 0 ? errors : undefined,
        },
      }
    } catch (err: any) {
      return {
        documents: [],
        result: {
          success: false,
          pagesImported: 0,
          errors: [`Import failed: ${err.message}`],
        },
      }
    }
  }

  private async convertPageToDocument(
    spaceId: string,
    page: GitBookPage,
    pageIdToPath?: Map<string, string>,
    fileIdToUrl?: Map<string, string>
  ): Promise<RAGDocumentForImport | null> {
    if (page.kind !== 'document' && page.type !== 'document') {
      return null
    }

    const pageContent = await this.client.getPage(spaceId, page.id)

    const markdown = this.client.documentToMarkdown(pageContent, {
      publishedBaseUrl: this.publishedBaseUrl,
      spaceId,
      pageIdToPath,
      fileIdToUrl,
    })

    if (!markdown || markdown.trim().length === 0) {
      return null
    }

    const docId = this.generateDocumentId(spaceId, page.path)

    const pageUrl = this.publishedBaseUrl
      ? GitBookClient.buildPublishedUrl(this.publishedBaseUrl, page.path)
      : `https://app.gitbook.com/s/${spaceId}/${page.path}`

    const metadata: GitBookRAGMetadata = {
      source: 'gitbook',
      spaceId,
      pageId: page.id,
      pagePath: page.path,
      pageTitle: page.title,
      pageUrl,
      importedAt: new Date().toISOString(),
    }

    return {
      id: docId,
      content: this.formatContentWithMetadata(markdown, metadata),
      metadata,
    }
  }

  private generateDocumentId(spaceId: string, pagePath: string): string {
    const safePath = pagePath.replace(/[^a-zA-Z0-9-]/g, '-')
    return `gitbook-${spaceId}-${safePath}`
  }

  private formatContentWithMetadata(
    content: string,
    metadata: GitBookRAGMetadata
  ): string {
    const header = `---
source: ${metadata.source}
spaceId: ${metadata.spaceId}
pagePath: ${metadata.pagePath}
pageTitle: ${metadata.pageTitle}
pageUrl: ${metadata.pageUrl}
importedAt: ${metadata.importedAt}
---

# ${metadata.pageTitle}

`
    return header + content
  }

  chunkContent(
    document: RAGDocumentForImport,
    chunkSize: number = 1000,
    overlap: number = 200
  ): RAGDocumentForImport[] {
    const content = document.content
    const chunks = this.splitTextIntoChunks(content, chunkSize, overlap)

    return chunks.map((chunk, index) => ({
      id: `${document.id}-chunk-${index}`,
      content: chunk,
      metadata: {
        ...document.metadata,
        chunkIndex: index,
        totalChunks: chunks.length,
      },
    }))
  }

  private splitTextIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number
  ): string[] {
    const chunks: string[] = []
    const paragraphs = text.split(/\n\n+/)

    let currentChunk = ''

    for (const para of paragraphs) {
      if (currentChunk.length + para.length < chunkSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + para
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
        }

        if (para.length > chunkSize) {
          const sentences = para.match(/[^.!?]+[.!?]+/g) || [para]
          let sentenceChunk = ''

          for (const sentence of sentences) {
            if (sentenceChunk.length + sentence.length < chunkSize) {
              sentenceChunk += sentence
            } else {
              if (sentenceChunk) {
                chunks.push(sentenceChunk.trim())
              }
              sentenceChunk = sentence
            }
          }

          currentChunk = sentenceChunk || ''
        } else {
          currentChunk = para
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }

    if (overlap > 0 && chunks.length > 1) {
      const overlappedChunks: string[] = []

      for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i]

        if (i > 0) {
          const prevChunk = chunks[i - 1]
          const overlapText = prevChunk.slice(-overlap)
          chunk = overlapText + ' ' + chunk
        }

        overlappedChunks.push(chunk)
      }

      return overlappedChunks
    }

    return chunks
  }

  async validateConnection(): Promise<boolean> {
    return this.client.validateConnection()
  }

  async validateConnectionWithSpace(spaceId: string): Promise<boolean> {
    return this.client.validateConnectionWithSpace(spaceId)
  }
}
