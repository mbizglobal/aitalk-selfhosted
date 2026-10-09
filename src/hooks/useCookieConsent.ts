'use client'

import { useState, useEffect } from 'react'
import { hasCookieConsent } from '@/lib/cookie-consent'

export function useCookieConsent() {
  const [hasConsented, setHasConsented] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const checkConsent = () => {
      setHasConsented(hasCookieConsent())
      setIsLoaded(true)
    }

    checkConsent()

    const handleStorageChange = () => {
      checkConsent()
    }

    window.addEventListener('storage', handleStorageChange)
    
    const handleCustomStorageChange = () => {
      checkConsent()
    }
    
    window.addEventListener('cookie-consent-changed', handleCustomStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('cookie-consent-changed', handleCustomStorageChange)
    }
  }, [])

  return {
    hasConsented,
    isLoaded
  }
}