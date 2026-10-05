'use client'

import { useState, useEffect } from 'react'

export function useCookieConsent() {
  const [hasConsented, setHasConsented] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    const checkConsent = () => {
      const consent = localStorage.getItem('cookie-consent')
      setHasConsented(consent === 'true')
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