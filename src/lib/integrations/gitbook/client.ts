
import {
  GitBookClientConfig,
  GitBookSpace,
  GitBookPage,
  GitBookPageContent,
  GitBookSpaceContent,
  GitBookSearchResponse,
  GitBookSearchResult,
  GitBookListResponse,
} from './types'
import { describeUpstreamError, readUpstreamJson } from '@/lib/log-mask'

const DEFAULT_BASE_URL = 'https://api.gitbook.com/v1'

export class GitBookClient {
  private accessToken: string
  private baseUrl: string

  constructor(config: GitBookClientConfig) {
    this.accessToken = config.accessToken
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL
  }

  // ===========================================================================
  // ===========================================================================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      throw new GitBookAPIError(
        `GitBook API Error: ${response.status} ${response.statusText}`,
        response.status,
        describeUpstreamError(response.status, await response.text())
      )
    }

    return readUpstreamJson(response)
  }

  // ===========================================================================
  // ===========================================================================

  async getSpace(spaceId: string): Promise<GitBookSpace> {
    return this.request<GitBookSpace>(`/spaces/${spaceId}`)
  }

  async listSpaces(): Promise<GitBookSpace[]> {
    const response = await this.request<GitBookListResponse<GitBookSpace>>(
      '/spaces'
    )
    return response.items || []
  }

  // ===========================================================================
  // ===========================================================================

  async listPages(spaceId: string): Promise<GitBookPage[]> {
    const content = await this.request<GitBookSpaceContent>(
      `/spaces/${spaceId}/content`
    )
    return content.pages || []
  }

  async getFileIdToUrlMap(spaceId: string): Promise<Map<string, string>> {
    const content = await this.request<GitBookSpaceContent>(
      `/spaces/${spaceId}/content`
    )
    const fileMap = new Map<string, string>()
    if (content.files && Array.isArray(content.files)) {
      for (const file of content.files) {
        if (file.id && file.downloadURL) {
          fileMap.set(file.id, file.downloadURL)
        }
      }
    }
    return fileMap
  }

  async getPage(spaceId: string, pageId: string): Promise<GitBookPageContent> {
    return this.request<GitBookPageContent>(
      `/spaces/${spaceId}/content/page/${pageId}`
    )
  }

  async getPageByPath(
    spaceId: string,
    pagePath: string
  ): Promise<GitBookPageContent> {
    const encodedPath = encodeURIComponent(pagePath)
    return this.request<GitBookPageContent>(
      `/spaces/${spaceId}/content/path/${encodedPath}`
    )
  }

  // ===========================================================================
  // ===========================================================================

  async search(
    spaceId: string,
    query: string
  ): Promise<GitBookSearchResult[]> {
    const truncatedQuery = query.slice(0, 512)
    const response = await this.request<GitBookSearchResponse>(
      `/spaces/${spaceId}/search?query=${encodeURIComponent(truncatedQuery)}`
    )
    return response.items || []
  }

  // ===========================================================================
  // ===========================================================================

  async getAllPagesFlat(spaceId: string): Promise<GitBookPage[]> {
    const pages = await this.listPages(spaceId)
    return this.flattenPages(pages)
  }

  private flattenPages(pages: GitBookPage[]): GitBookPage[] {
    const result: GitBookPage[] = []

    const traverse = (pageList: GitBookPage[]) => {
      for (const page of pageList) {
        if (page.kind === 'document' || page.type === 'document') {
          result.push(page)
        }
        if (page.pages && page.pages.length > 0) {
          traverse(page.pages)
        }
      }
    }

    traverse(pages)
    return result
  }

  documentToMarkdown(
    pageContent: GitBookPageContent,
    options?: {
      publishedBaseUrl?: string
      spaceId?: string
      pageIdToPath?: Map<string, string>
      fileIdToUrl?: Map<string, string>
    }
  ): string {
    if (!pageContent.document) {
      return ''
    }

    const { publishedBaseUrl, spaceId, pageIdToPath, fileIdToUrl } = options || {}
    const lines: string[] = []

    const convertToPublishedUrl = (url: string, pagePath?: string, pageId?: string): string => {
      if (pageId && pageIdToPath) {
        const mappedPath = pageIdToPath.get(pageId)
        if (mappedPath) {
          pagePath = mappedPath
        }
      }

      if (!url && !pagePath) return ''

      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        if (publishedBaseUrl && url.includes('app.gitbook.com')) {
          const idMatch = url.match(/\/s\/[^/]+\/([^/?#]+)/)
          if (idMatch && pageIdToPath) {
            const extractedId = idMatch[1]
            const mappedPath = pageIdToPath.get(extractedId)
            if (mappedPath) {
              return `https://${publishedBaseUrl.replace(/^https?:\/\//, '')}/${mappedPath}`
            }
          }
          const pathMatch = url.match(/\/s\/[^/]+\/(.+)$/)
          if (pathMatch) {
            return `https://${publishedBaseUrl.replace(/^https?:\/\//, '')}/${pathMatch[1]}`
          }
        }
        return url
      }

      const path = pagePath || url
      if (path && publishedBaseUrl) {
        const cleanPath = path.replace(/^\//, '')
        return `https://${publishedBaseUrl.replace(/^https?:\/\//, '')}/${cleanPath}`
      }

      if (path && spaceId) {
        const cleanPath = path.replace(/^\//, '')
        return `https://app.gitbook.com/s/${spaceId}/${cleanPath}`
      }

      return url || ''
    }

    const processNode = (node: any, depth: number = 0): void => {
      switch (node.type) {
        case 'heading-1':
          lines.push(`# ${this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
          break
        case 'heading-2':
          lines.push(`## ${this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
          break
        case 'heading-3':
          lines.push(`### ${this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
          break
        case 'paragraph':
          lines.push(this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath }))
          break
        case 'list-unordered':
        case 'list-ordered':
          if (node.nodes) {
            node.nodes.forEach((item: any, index: number) => {
              const prefix = node.type === 'list-ordered' ? `${index + 1}.` : '-'
              lines.push(`${prefix} ${this.extractText(item, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
            })
          }
          break
        case 'code-block':
          const lang = node.data?.language || ''
          lines.push(`\`\`\`${lang}`)
          lines.push(this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath }))
          lines.push('```')
          break
        case 'blockquote':
          lines.push(`> ${this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
          break
        case 'hint':
          const hintType = node.data?.style || 'info'
          lines.push(`> **${hintType.toUpperCase()}**: ${this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })}`)
          break
        case 'link':
          const linkPageId = node.data?.ref?.page || ''
          const linkPagePath = node.data?.ref?.path || ''
          const linkRawUrl = node.data?.url || node.data?.href || node.data?.ref?.href || ''
          const linkUrl = convertToPublishedUrl(linkRawUrl, linkPagePath, linkPageId)
          const linkText = this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath }) || linkUrl
          if (linkUrl) {
            lines.push(`[${linkText}](${linkUrl})`)
          } else if (linkText) {
            lines.push(linkText)
          }
          break
        case 'image':
        case 'images':
          const imgFileId = node.data?.ref?.file || ''
          let imgUrl = node.data?.url || node.data?.src || node.data?.ref?.url || ''

          if (imgFileId && fileIdToUrl) {
            const mappedUrl = fileIdToUrl.get(imgFileId)
            if (mappedUrl) {
              imgUrl = mappedUrl
            }
          }

          const imgAlt = node.data?.alt || node.data?.caption || ''
          if (imgUrl) {
            lines.push(`![${imgAlt}](${imgUrl})`)
          }

          if (node.type === 'images' && node.nodes) {
            for (const imgNode of node.nodes) {
              if (imgNode.type === 'image') {
                const innerFileId = imgNode.data?.ref?.file || ''
                let innerUrl = imgNode.data?.url || imgNode.data?.src || imgNode.data?.ref?.url || ''
                if (innerFileId && fileIdToUrl) {
                  const mappedUrl = fileIdToUrl.get(innerFileId)
                  if (mappedUrl) {
                    innerUrl = mappedUrl
                  }
                }
                const innerAlt = imgNode.data?.alt || imgNode.data?.caption || ''
                if (innerUrl) {
                  lines.push(`![${innerAlt}](${innerUrl})`)
                }
              }
            }
          }
          break
        case 'embed':
          const embedRawUrl = node.data?.url || node.data?.href || ''
          const embedUrl = convertToPublishedUrl(embedRawUrl)
          const embedTitle = node.data?.title || 'Embedded content'
          if (embedUrl) {
            lines.push(`[${embedTitle}](${embedUrl})`)
          }
          break
        case 'file':
          const fileUrl = node.data?.url || node.data?.href || node.data?.ref?.url || ''
          const fileName = node.data?.name || node.data?.title || 'File'
          if (fileUrl) {
            lines.push(`[📎 ${fileName}](${fileUrl})`)
          }
          break
        default:
          const text = this.extractText(node, { publishedBaseUrl, spaceId, convertToPublishedUrl, pageIdToPath })
          if (text) {
            lines.push(text)
          }
      }

      const skipChildProcessing = [
        'list-unordered', 'list-ordered', 'code-block',
        'link', 'image', 'images', 'embed', 'file'
      ]
      if (node.nodes && !skipChildProcessing.includes(node.type)) {
        node.nodes.forEach((child: any) => processNode(child, depth + 1))
      }
    }

    pageContent.document.nodes.forEach((node) => processNode(node))

    return lines.filter(Boolean).join('\n\n')
  }

  private extractText(
    node: any,
    options?: {
      publishedBaseUrl?: string
      spaceId?: string
      convertToPublishedUrl?: (url: string, pagePath?: string, pageId?: string) => string
      pageIdToPath?: Map<string, string>
    }
  ): string {
    if (!node) return ''

    const { convertToPublishedUrl } = options || {}

    if (node.type === 'link') {
      const linkPageId = node.data?.ref?.page || ''
      const linkPagePath = node.data?.ref?.path || ''
      const linkRawUrl = node.data?.url || node.data?.href || node.data?.ref?.href || ''
      const linkUrl = convertToPublishedUrl
        ? convertToPublishedUrl(linkRawUrl, linkPagePath, linkPageId)
        : linkRawUrl
      const linkText = node.nodes
        ? node.nodes.map((child: any) => this.extractText(child, options)).join('')
        : ''
      if (linkUrl) {
        return `[${linkText || linkUrl}](${linkUrl})`
      }
      return linkText
    }

    if (node.type === 'image') {
      const imgUrl = node.data?.url || node.data?.src || node.data?.ref?.url || ''
      const imgAlt = node.data?.alt || node.data?.caption || ''
      if (imgUrl) {
        return `![${imgAlt}](${imgUrl})`
      }
      return ''
    }

    if (node.leaves) {
      return node.leaves.map((leaf: any) => leaf.text || '').join('')
    }

    if (node.nodes) {
      return node.nodes.map((child: any) => this.extractText(child, options)).join('')
    }

    if (node.text) {
      return node.text
    }

    return ''
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.listSpaces()
      return true
    } catch {
      return false
    }
  }

  async validateConnectionWithSpace(spaceId: string): Promise<boolean> {
    try {
      await this.getSpace(spaceId)
      return true
    } catch {
      return false
    }
  }

  static buildPublishedUrl(baseUrl: string, pagePath: string): string {
    const cleanBase = baseUrl.replace(/\/$/, '')
    const cleanPath = pagePath.replace(/^\//, '')
    return `https://${cleanBase}/${cleanPath}`
  }
}

// =============================================================================
// =============================================================================

export class GitBookAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public detail?: string
  ) {
    super(message)
    this.name = 'GitBookAPIError'
  }
}
