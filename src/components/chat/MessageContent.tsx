'use client'

import React, { useEffect, useMemo, useRef } from 'react'
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
  tableActions?: (read: () => RenderedTable) => React.ReactNode
}

export interface RenderedTable { header: string[]; rows: string[][]; align: Array<'left' | 'right' | 'center'> }

function readTable(el: HTMLTableElement | null): RenderedTable {
  const text = (c: Element) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
  const alignOf = (c: Element | undefined) => { const a = c ? (c as HTMLElement).style.textAlign : ''; return a === 'right' || a === 'center' ? a : 'left' }
  const headCells = el ? Array.from(el.querySelectorAll('thead tr:first-child > th, thead tr:first-child > td')) : []
  const bodyRows = el ? Array.from(el.querySelectorAll('tbody tr')) : []
  const firstBody = bodyRows[0] ? Array.from(bodyRows[0].children) : []
  return {
    header: headCells.map(text),
    rows: bodyRows.map((r) => Array.from(r.children).map(text)),
    align: headCells.map((c, i) => (alignOf(c) !== 'left' ? alignOf(c) : alignOf(firstBody[i]))),
  }
}

function TableWithActions({ children, render, actions }: { children: React.ReactNode; render: (props: Record<string, unknown>) => React.ReactNode; actions: NonNullable<MessageContentProps['tableActions']> }) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div ref={box}>
      {render({ children })}
      {actions(() => readTable(box.current?.querySelector('table') ?? null))}
    </div>
  )
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
  tableActions,
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
  const components = useMemo(() => {
    const base = remoteImages ? markdownComponents : { ...markdownComponents, img: ({ src, alt }: { src?: unknown; alt?: string }) => <BlockedImage src={src} alt={alt} /> }
    if (!tableActions) return base
    const Table = (base as Record<string, unknown>).table as ((p: Record<string, unknown>) => React.ReactNode) | undefined
    const render = (p: Record<string, unknown>) => (Table ? Table(p) : <table>{p.children as React.ReactNode}</table>)
    return { ...base, table: ({ children }: { children?: React.ReactNode }) => <TableWithActions render={render} actions={tableActions}>{children}</TableWithActions> }
  }, [markdownComponents, remoteImages, tableActions])

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
