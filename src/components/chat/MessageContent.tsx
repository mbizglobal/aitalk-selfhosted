'use client'

import React, { useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'
import {
  createMarkdownComponents,
  lightMarkdownComponents,
  darkMarkdownComponents,
} from './markdownComponents'
import { renderJSONAsTable, tryParseJSON, type TableTheme } from './jsonTableRenderer'

function removeIncompleteCitations(text: string): string {
  if (!text) return text
  return text.replace(/【[^\】]*$/g, '')
}

export interface MessageContentProps {
  content: string
  role: 'user' | 'assistant' | 'error' | 'system'
  theme?: 'light' | 'dark'
  size?: 'xs' | 'sm' | 'base'
  onHasTable?: (hasTable: boolean) => void
  isStreaming?: boolean
  enableJsonTable?: boolean
  remoteImages?: boolean
}

const BlockedImage = ({ src, alt }: { src?: unknown; alt?: string }) => (
  <span className="break-all opacity-70">{`![${alt ?? ''}](${typeof src === 'string' ? src : ''})`}</span>
)

export const MessageContent: React.FC<MessageContentProps> = ({
  content,
  role,
  theme = 'light',
  size = 'sm',
  onHasTable,
  isStreaming = false,
  enableJsonTable = true,
  remoteImages = true,
}) => {
  const markdownComponents = useMemo(() => {
    if (theme === 'dark' && size === 'xs') {
      return darkMarkdownComponents
    }
    if (theme === 'light' && size === 'sm') {
      return lightMarkdownComponents
    }
    return createMarkdownComponents({ theme, size })
  }, [theme, size])
  const components = useMemo(
    () => (remoteImages ? markdownComponents : { ...markdownComponents, img: ({ src, alt }: { src?: unknown; alt?: string }) => <BlockedImage src={src} alt={alt} /> }),
    [markdownComponents, remoteImages],
  )

  const tableTheme: TableTheme = theme

  const hasTable = useMemo(() => {
    if (isStreaming || !enableJsonTable) return false
    if (role === 'assistant' || role === 'error') {
      const jsonData = tryParseJSON(content)
      if (jsonData) {
        const tableElement = renderJSONAsTable(jsonData, tableTheme)
        return !!tableElement
      }
    }
    return false
  }, [content, role, isStreaming, enableJsonTable, tableTheme])

  useEffect(() => {
    onHasTable?.(hasTable)
  }, [hasTable, onHasTable])

  if ((role === 'assistant' || role === 'error') && !isStreaming && enableJsonTable) {
    const jsonData = tryParseJSON(content)

    if (jsonData) {
      const tableElement = renderJSONAsTable(jsonData, tableTheme)
      if (tableElement) {
        return tableElement
      }
    }
  }

  if (role === 'assistant' || role === 'error') {
    const displayContent = isStreaming ? removeIncompleteCitations(content) : content
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]} components={components}>
        {displayContent}
      </ReactMarkdown>
    )
  }

  return <span className="whitespace-pre-wrap">{content}</span>
}
