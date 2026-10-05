import React from 'react'

export type TableTheme = 'light' | 'dark'

interface TableColors {
  border: string
  headerBg: string
  headerText: string
  cellText: string
  divider: string
  metaText: string
}

const getTableColors = (theme: TableTheme): TableColors => {
  if (theme === 'dark') {
    return {
      border: 'border-gray-600',
      headerBg: 'bg-gray-800',
      headerText: 'text-gray-100',
      cellText: 'text-gray-100',
      divider: 'divide-gray-700',
      metaText: 'text-gray-400',
    }
  }
  // light theme
  return {
    border: 'border-gray-300',
    headerBg: 'bg-gray-100',
    headerText: 'text-gray-900',
    cellText: 'text-gray-700',
    divider: 'divide-gray-200',
    metaText: 'text-gray-500',
  }
}

export const renderJSONAsTable = (jsonData: any, theme: TableTheme = 'dark'): React.ReactElement | null => {
  const colors = getTableColors(theme)

  try {
    if (jsonData.transactions && Array.isArray(jsonData.transactions)) {
      const transactions = jsonData.transactions
      if (transactions.length === 0) return null

      const headers = Object.keys(transactions[0])

      return (
        <div className="my-4">
          <div className="overflow-x-auto">
            <table className={`border-collapse border ${colors.border} w-full text-xs`}>
              <thead className={colors.headerBg}>
                <tr>
                  {headers.map((header) => (
                    <th key={header} className={`px-2 py-1 text-left text-sm font-semibold ${colors.headerText} border ${colors.border}`}>
                      {header.replace(/_/g, ' ').toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`${colors.divider} divide-y`}>
                {transactions.map((transaction: any, idx: number) => (
                  <tr key={idx} className={`border-b ${colors.border}`}>
                    {headers.map((header) => (
                      <td key={header} className={`px-2 py-1 text-sm ${colors.cellText} border ${colors.border}`}>
                        {typeof transaction[header] === 'number'
                          ? transaction[header].toLocaleString()
                          : transaction[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {jsonData.bankType && (
            <div className={`mt-2 text-xs ${colors.metaText}`}>
              Bank: {jsonData.bankType} | Currency: {jsonData.currency}
            </div>
          )}
        </div>
      )
    }

    if (Array.isArray(jsonData) && jsonData.length > 0 && typeof jsonData[0] === 'object') {
      const headers = Object.keys(jsonData[0])

      return (
        <div className="my-4">
          <div className="overflow-x-auto">
            <table className={`border-collapse border ${colors.border} w-full text-xs`}>
              <thead className={colors.headerBg}>
                <tr>
                  {headers.map((header) => (
                    <th key={header} className={`px-2 py-1 text-left text-sm font-semibold ${colors.headerText} border ${colors.border}`}>
                      {header.replace(/_/g, ' ').toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`${colors.divider} divide-y`}>
                {jsonData.map((item: any, idx: number) => (
                  <tr key={idx} className={`border-b ${colors.border}`}>
                    {headers.map((header) => (
                      <td key={header} className={`px-2 py-1 text-sm ${colors.cellText} border ${colors.border}`}>
                        {typeof item[header] === 'number'
                          ? item[header].toLocaleString()
                          : item[header]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return null
  } catch (error) {
    console.error('Error rendering JSON as table:', error)
    return null
  }
}

export const tryParseJSON = (content: string): any | null => {
  const jsonPattern = /^(\{[\s\S]*\})$/
  const match = content.trim().match(jsonPattern)

  if (match) {
    try {
      return JSON.parse(match[1])
    } catch (e) {
      return null
    }
  }

  return null
}
