
import { useState } from 'react'
import type { WebSearchToolConfig } from '../types'

export function useWebSearchTool() {
  const [webSearchDomains, setWebSearchDomains] = useState<string>('')
  const [webSearchCountry, setWebSearchCountry] = useState<string>('')
  const [webSearchCountrySearch, setWebSearchCountrySearch] = useState<string>('')
  const [webSearchCountryDropdownOpen, setWebSearchCountryDropdownOpen] = useState<boolean>(false)
  const [webSearchRegion, setWebSearchRegion] = useState<string>('')
  const [webSearchCity, setWebSearchCity] = useState<string>('')
  const [webSearchTimezone, setWebSearchTimezone] = useState<string>('')
  const [webSearchContextSize, setWebSearchContextSize] = useState<'high' | 'medium' | 'low'>('medium')

  const resetWebSearchConfig = () => {
    setWebSearchDomains('')
    setWebSearchCountry('')
    setWebSearchCountrySearch('')
    setWebSearchCountryDropdownOpen(false)
    setWebSearchRegion('')
    setWebSearchCity('')
    setWebSearchTimezone('')
    setWebSearchContextSize('medium')
  }

  const getWebSearchConfig = (): WebSearchToolConfig => ({
    domains: webSearchDomains,
    country: webSearchCountry,
    region: webSearchRegion,
    city: webSearchCity,
    timezone: webSearchTimezone,
    contextSize: webSearchContextSize
  })

  return {
    // State
    webSearchDomains,
    setWebSearchDomains,
    webSearchCountry,
    setWebSearchCountry,
    webSearchCountrySearch,
    setWebSearchCountrySearch,
    webSearchCountryDropdownOpen,
    setWebSearchCountryDropdownOpen,
    webSearchRegion,
    setWebSearchRegion,
    webSearchCity,
    setWebSearchCity,
    webSearchTimezone,
    setWebSearchTimezone,
    webSearchContextSize,
    setWebSearchContextSize,

    // Functions
    resetWebSearchConfig,
    getWebSearchConfig
  }
}