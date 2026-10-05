import React from 'react'
import type { Components } from 'react-markdown'

export interface MarkdownComponentsOptions {
  theme?: 'light' | 'dark'
  size?: 'xs' | 'sm' | 'base'
}

export function createMarkdownComponents(options: MarkdownComponentsOptions = {}): Components {
  const { theme = 'light', size = 'sm' } = options
  const isDark = theme === 'dark'

  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    base: 'text-base',
  }
  const textSize = sizeClasses[size]
  const codeSize = size === 'xs' ? 'text-[10px]' : 'text-xs'

  const colors = isDark ? {
    text: 'text-gray-100',
    textMuted: 'text-gray-300',
    textStrong: 'text-white',
    link: 'text-blue-400',
    codeBg: 'bg-[#1A1A1A]',
    codeText: 'text-green-400',
    preBg: 'bg-gray-900',
    preText: 'text-gray-100',
    inlineCodeBg: 'bg-gray-700',
    blockquoteBorder: 'border-gray-500',
    blockquoteText: 'text-gray-400',
    tableBorder: 'border-gray-600',
    tableHeaderBg: 'bg-gray-800',
    tableHeaderText: 'text-gray-200',
    tableCellText: 'text-gray-300',
    tableDivide: 'divide-gray-700',
  } : {
    text: '',
    textMuted: 'text-gray-700',
    textStrong: '',
    link: 'text-blue-600',
    codeBg: 'bg-gray-200',
    codeText: '',
    preBg: 'bg-gray-900',
    preText: 'text-gray-100',
    inlineCodeBg: 'bg-gray-200',
    blockquoteBorder: 'border-gray-300',
    blockquoteText: '',
    tableBorder: 'border-gray-300',
    tableHeaderBg: 'bg-gray-100',
    tableHeaderText: '',
    tableCellText: '',
    tableDivide: 'divide-gray-200',
  }

  const spacing = size === 'xs' ? {
    pMargin: 'mb-1',
    listSpacing: 'space-y-0.5',
    listMargin: 'ml-2',
    tablePadding: 'px-2 py-1',
    prePadding: 'p-2',
    preMargin: 'my-1',
  } : {
    pMargin: 'mb-2',
    listSpacing: 'space-y-1',
    listMargin: 'pl-5',
    tablePadding: 'px-3 py-2',
    prePadding: 'p-3',
    preMargin: 'my-2',
  }

  return {
    p: ({ node, children, className, ...props }) => {
      const hasBlockElement = React.Children.toArray(children).some((child) => {
        if (React.isValidElement(child)) {
          const type = child.type
          if (typeof type === 'string' && ['pre', 'div', 'ul', 'ol', 'table', 'blockquote'].includes(type)) {
            return true
          }
          if (typeof type === 'function' && child.props && !child.props.inline) {
            return false
          }
        }
        return false
      })

      const classes = [
        `${spacing.pMargin} last:mb-0 leading-relaxed`,
        textSize,
        className,
      ].filter(Boolean).join(' ')

      if (hasBlockElement) {
        return <div {...props} className={classes}>{children}</div>
      }
      return <p {...props} className={classes}>{children}</p>
    },
    strong: ({ node, children, className, ...props }) => (
      <strong
        {...props}
        className={[
          `font-bold ${colors.textStrong}`,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </strong>
    ),
    em: ({ node, children, className, ...props }) => (
      <em
        {...props}
        className={[
          'italic',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </em>
    ),
    a: ({ node, children, className, ...props }) => (
      <a
        {...props}
        className={[
          `${colors.link} hover:underline break-all`,
          textSize,
          className,
        ].filter(Boolean).join(' ')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),
    img: ({ node, className, ...props }) => (
      <img
        {...props}
        className={[
          'mx-auto my-4 max-w-full rounded-lg',
          className,
        ].filter(Boolean).join(' ')}
      />
    ),
    pre: ({ node, children, className, ...props }) => (
      <pre
        {...props}
        className={[
          `${colors.preBg} ${colors.preText} rounded-md ${spacing.prePadding} overflow-x-auto ${codeSize} ${spacing.preMargin}`,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </pre>
    ),
    code: ({ node, inline, className, children, ...props }: any) => {
      if (inline) {
        return (
          <code
            {...props}
            className={[
              `rounded ${colors.inlineCodeBg} ${colors.codeText} px-1 py-0.5 font-mono`,
              codeSize,
              className,
            ].filter(Boolean).join(' ')}
          >
            {children}
          </code>
        )
      }
      return (
        <code
          {...props}
          className={[
            'font-mono',
            className,
          ].filter(Boolean).join(' ')}
        >
          {children}
        </code>
      )
    },
    ul: ({ node, children, className, ...props }) => (
      <ul
        {...props}
        className={[
          `list-disc ${spacing.listMargin} ${spacing.listSpacing}`,
          size === 'xs' ? 'list-inside' : '',
          textSize,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </ul>
    ),
    ol: ({ node, children, className, ...props }) => (
      <ol
        {...props}
        className={[
          `list-decimal ${spacing.listMargin} ${spacing.listSpacing}`,
          size === 'xs' ? 'list-inside' : '',
          textSize,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </ol>
    ),
    li: ({ node, children, className, ...props }) => (
      <li
        {...props}
        className={[
          'leading-relaxed',
          textSize,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </li>
    ),
    blockquote: ({ node, children, className, ...props }) => (
      <blockquote
        {...props}
        className={[
          `border-l-2 ${colors.blockquoteBorder} pl-3 italic ${colors.blockquoteText}`,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </blockquote>
    ),
    h1: ({ node, children, className, ...props }) => (
      <h1
        {...props}
        className={[
          'font-bold mb-2',
          size === 'xs' ? 'text-xs' : 'text-lg',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </h1>
    ),
    h2: ({ node, children, className, ...props }) => (
      <h2
        {...props}
        className={[
          'font-bold mb-2',
          size === 'xs' ? 'text-xs' : 'text-base',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </h2>
    ),
    h3: ({ node, children, className, ...props }) => (
      <h3
        {...props}
        className={[
          'font-semibold mb-1',
          size === 'xs' ? 'text-xs' : 'text-sm',
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </h3>
    ),
    table: ({ node, children, className, ...props }) => (
      <div className="overflow-x-auto my-2">
        <table
          {...props}
          className={[
            `min-w-full border-collapse ${colors.tableBorder} border`,
            textSize,
            className,
          ].filter(Boolean).join(' ')}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ node, children, className, ...props }) => (
      <thead
        {...props}
        className={[
          colors.tableHeaderBg,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </thead>
    ),
    tbody: ({ node, children, className, ...props }) => (
      <tbody
        {...props}
        className={[
          `${colors.tableDivide} divide-y`,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </tbody>
    ),
    tr: ({ node, children, className, ...props }) => (
      <tr
        {...props}
        className={[
          `${colors.tableBorder} border-b`,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </tr>
    ),
    th: ({ node, children, className, ...props }) => (
      <th
        {...props}
        className={[
          `${spacing.tablePadding} text-left font-semibold ${colors.tableHeaderText} ${colors.tableBorder} border`,
          textSize,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </th>
    ),
    td: ({ node, children, className, ...props }) => (
      <td
        {...props}
        className={[
          `${spacing.tablePadding} ${colors.tableCellText} ${colors.tableBorder} border`,
          textSize,
          className,
        ].filter(Boolean).join(' ')}
      >
        {children}
      </td>
    ),
  }
}

export const lightMarkdownComponents = createMarkdownComponents({ theme: 'light', size: 'sm' })
export const darkMarkdownComponents = createMarkdownComponents({ theme: 'dark', size: 'xs' })
