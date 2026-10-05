import { useEffect, useRef } from 'react'

interface UseUnsavedChangesOptions {
  hasChanges: boolean
  message?: string
}

export const useUnsavedChanges = ({ hasChanges, message }: UseUnsavedChangesOptions) => {
  const defaultMessage = 'You have unsaved changes. Are you sure you want to leave without saving?'
  const hasChangesRef = useRef(hasChanges)

  useEffect(() => {
    hasChangesRef.current = hasChanges
  }, [hasChanges])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault()
        e.returnValue = '' // Chrome requires returnValue to be set
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])

  useEffect(() => {
    const currentUrl = window.location.href

    const handlePopState = (e: PopStateEvent) => {
      if (hasChangesRef.current) {
        const confirmed = window.confirm(message || defaultMessage)
        if (!confirmed) {
          window.history.pushState(null, '', currentUrl)
        }
      }
    }

    window.addEventListener('popstate', handlePopState)

    window.history.pushState(null, '', currentUrl)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [message, defaultMessage])

  const confirmLeave = (): boolean => {
    if (!hasChanges) {
      return true
    }

    return window.confirm(message || defaultMessage)
  }

  return {
    confirmLeave
  }
}
