'use client'

import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { getNodeTypeEmoji, getNodeTypeColor } from '../utils/analyzeDependencies'

interface VariableInfo {
  nodeId: string
  nodeName: string
  nodeType: string
}

interface VariableChipEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  availableVariables: VariableInfo[]
  className?: string
  minHeight?: string
}

export interface VariableChipEditorRef {
  insertVariable: (nodeId: string) => void
  focus: () => void
}

const VARIABLE_REGEX = /(\{\{(?:context\.([a-zA-Z0-9_-]+)|message)\}\})/g

function parseContent(text: string): Array<{ type: 'text' | 'variable'; value: string; nodeId?: string }> {
  const tokens: Array<{ type: 'text' | 'variable'; value: string; nodeId?: string }> = []
  let lastIndex = 0
  let match

  const regex = new RegExp(VARIABLE_REGEX.source, 'g')

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.substring(lastIndex, match.index)
      })
    }

    const fullMatch = match[1]
    const nodeId = match[2] || 'message'
    tokens.push({
      type: 'variable',
      value: fullMatch,
      nodeId
    })

    lastIndex = match.index + fullMatch.length
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      value: text.substring(lastIndex)
    })
  }

  return tokens
}

function extractTextFromHtml(container: HTMLElement): string {
  let result = ''

  container.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.dataset.variable) {
        result += element.dataset.variable
      } else if (element.tagName === 'BR') {
        result += '\n'
      } else if (element.tagName === 'DIV' || element.tagName === 'P') {
        const innerText = extractTextFromHtml(element)
        if (result && !result.endsWith('\n')) {
          result += '\n'
        }
        result += innerText
      } else {
        result += extractTextFromHtml(element)
      }
    }
  })

  return result
}

export const VariableChipEditor = forwardRef<VariableChipEditorRef, VariableChipEditorProps>(({
  value,
  onChange,
  placeholder,
  availableVariables,
  className = '',
  minHeight = '350px'
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const isComposing = useRef(false)
  const lastValue = useRef(value)

  const getVariableInfo = useCallback((nodeId: string): VariableInfo => {
    if (nodeId === 'message') {
      return { nodeId: 'message', nodeName: 'User Message', nodeType: 'system' }
    }
    const found = availableVariables.find(v => v.nodeId === nodeId)
    return found || { nodeId, nodeName: nodeId, nodeType: 'unknown' }
  }, [availableVariables])

  const createChipHtml = useCallback((variableText: string, nodeId: string): string => {
    const info = getVariableInfo(nodeId)
    const emoji = getNodeTypeEmoji(info.nodeType)
    const colorClass = getNodeTypeColor(info.nodeType)

    return `<span contenteditable="false" data-variable="${variableText}" class="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-xs rounded border cursor-default select-none align-middle ${colorClass}"><span class="text-[10px]">${emoji}</span><span class="truncate max-w-[120px]">${info.nodeName}</span></span>`
  }, [getVariableInfo])

  const textToHtml = useCallback((text: string): string => {
    const tokens = parseContent(text)
    let html = ''

    for (const token of tokens) {
      if (token.type === 'text') {
        const escaped = token.value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')
        html += escaped
      } else if (token.type === 'variable' && token.nodeId) {
        html += createChipHtml(token.value, token.nodeId)
      }
    }

    return html || '<br>'
  }, [createChipHtml])

  useEffect(() => {
    if (!editorRef.current) return

    if (value !== lastValue.current) {
      lastValue.current = value
      const html = textToHtml(value)
      editorRef.current.innerHTML = html
    }
  }, [value, textToHtml])

  useEffect(() => {
    if (!editorRef.current) return
    const html = textToHtml(value)
    editorRef.current.innerHTML = html
    lastValue.current = value
  }, [])

  const handleInput = useCallback(() => {
    if (!editorRef.current || isComposing.current) return

    const newValue = extractTextFromHtml(editorRef.current)
    if (newValue !== lastValue.current) {
      lastValue.current = newValue
      onChange(newValue)
    }
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      document.execCommand('insertLineBreak')
    }
  }, [])

  const handleCompositionStart = () => {
    isComposing.current = true
  }

  const handleCompositionEnd = () => {
    isComposing.current = false
    handleInput()
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }, [])

  const insertVariable = useCallback((nodeId: string) => {
    if (!editorRef.current) return

    const variableText = nodeId === 'message' ? '{{message}}' : `{{context.${nodeId}}}`
    const chipHtml = createChipHtml(variableText, nodeId)

    editorRef.current.focus()
    const selection = window.getSelection()

    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()

      const temp = document.createElement('div')
      temp.innerHTML = chipHtml
      const chip = temp.firstChild as Node
      range.insertNode(chip)

      range.setStartAfter(chip)
      range.setEndAfter(chip)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    const newValue = extractTextFromHtml(editorRef.current)
    lastValue.current = newValue
    onChange(newValue)
  }, [createChipHtml, onChange])

  useImperativeHandle(ref, () => ({
    insertVariable,
    focus: () => editorRef.current?.focus()
  }), [insertVariable])

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className={`w-full px-4 py-3 border border-[#3A3A3A] rounded-md bg-[#3A3A3A] text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary text-sm overflow-y-auto whitespace-pre-wrap break-words ${className}`}
        style={{
          minHeight,
          lineHeight: '1.6'
        }}
      />
      <style jsx>{`
        div[contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #6B7280;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
})

VariableChipEditor.displayName = 'VariableChipEditor'
