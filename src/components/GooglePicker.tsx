'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

interface GooglePickerProps {
  onFilesSelected: (files: PickedFile[]) => void
  buttonText?: string
  disabled?: boolean
  agentId?: string // Agent ID for server-side token
  ragProvider?: string // RAG Provider for file type filtering
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  className?: string
}

export interface PickedFile {
  id: string
  name: string
  mimeType: string
  iconUrl?: string
  url?: string
  resourceKey?: string
}

declare global {
  interface Window {
    google?: {
      picker: {
        PickerBuilder: any
        ViewId: any
        Feature: any
        DocsView: any
        Action: any
      }
      accounts: {
        oauth2: {
          initTokenClient: (config: any) => any
        }
      }
    }
    gapi?: {
      load: (api: string, callback: () => void) => void
      client: {
        setToken: (token: { access_token: string }) => void
      }
    }
  }
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const deriveGoogleAppId = () => {
  const explicit = process.env.NEXT_PUBLIC_GOOGLE_APP_ID
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim()
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  if (!clientId) {
    return undefined
  }

  const match = clientId.match(/^(\d+)-/)
  return match ? match[1] : undefined
}

function getSupportedMimeTypes(ragProvider?: string): string[] {
  const googleNativeTypes = [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
  ]

  switch (ragProvider) {
    case 'azure_ai_search':
      return [
        'text/plain', 'text/markdown',
        'application/json',
        'application/x-tex', 'text/x-tex',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg', 'image/png',
        ...googleNativeTypes,
      ]
    case 'gemini_file_search':
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/markdown',
        'application/json',
        'text/csv', 'text/html',
        'text/xml', 'application/xml',
        ...googleNativeTypes,
      ]
    case 'pinecone':
      return [
        'text/plain', 'text/markdown',
        'application/json',
        ...googleNativeTypes,
      ]
    case 'openai_vector_store':
    default:
      return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain', 'text/markdown',
        'application/json',
        'application/x-tex', 'text/x-tex',
        ...googleNativeTypes,
      ]
  }
}

export default function GooglePicker({
  onFilesSelected,
  buttonText = 'Select Files from Google Drive',
  disabled = false,
  agentId,
  ragProvider,
  variant = 'outline',
  className,
}: GooglePickerProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPickerLoaded, setIsPickerLoaded] = useState(false)
  const [isTokenClientReady, setIsTokenClientReady] = useState(false)
  const [, setServerToken] = useState<string | null>(null)
  const [cachedToken, setCachedToken] = useState<string | null>(null)
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null)
  const hasRequestedConsentRef = useRef(false)

  const googleAppId = useMemo(() => deriveGoogleAppId(), [])

  useEffect(() => {
    if (!agentId) return

    const fetchServerToken = async () => {
      try {
        const response = await fetch(`/api/storage/google-drive/token?agentId=${agentId}`)
        const data = await response.json()

        if (data.success && data.accessToken) {
          setServerToken(data.accessToken)
        } else if (data.needsReauth) {
          setServerToken(null)
        }
      } catch (error) {
        // Failed to fetch server token
      }
    }

    fetchServerToken()
  }, [agentId])

  useEffect(() => {
    const updateReadyState = () => {
      const pickerReady = !!window.google?.picker
      const gisReady = !!window.google?.accounts?.oauth2
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

      setIsPickerLoaded(pickerReady)
      setIsTokenClientReady(pickerReady && gisReady && !!clientId)
    }

    const loadGoogleAPIs = () => {
      if (!document.querySelector('script[src*="apis.google.com/js/api.js"]')) {
        const gapiScript = document.createElement('script')
        gapiScript.src = 'https://apis.google.com/js/api.js'
        gapiScript.async = true
        gapiScript.defer = true
        gapiScript.onload = () => {
          window.gapi?.load('picker', () => {
            updateReadyState()
          })
          window.gapi?.load('client', () => {
            updateReadyState()
          })
        }
        document.body.appendChild(gapiScript)
      } else {
        window.gapi?.load('picker', () => {
          updateReadyState()
        })
        window.gapi?.load('client', () => {
          updateReadyState()
        })
      }

      if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
        const gisScript = document.createElement('script')
        gisScript.src = 'https://accounts.google.com/gsi/client'
        gisScript.async = true
        gisScript.defer = true
        gisScript.onload = () => {
          updateReadyState()
        }
        document.body.appendChild(gisScript)
      } else {
        updateReadyState()
      }
    }

    loadGoogleAPIs()
    updateReadyState()
  }, [])

  const syncTokenWithServer = async (accessToken: string, expiresInSeconds?: number, scope?: string) => {
    if (!agentId) {
      return
    }

    try {
      await fetch('/api/storage/google-drive/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId,
          accessToken,
          expiresIn: expiresInSeconds,
          scope,
        }),
      })
    } catch (error) {
      // Failed to sync Google token with server
    }
  }

  const requestClientToken = async (apiKey: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

      if (!window.google?.accounts?.oauth2 || !clientId) {
        reject(new Error('Google Identity Services not ready'))
        return
      }
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: async (response: any) => {
          if (response.error) {
            if (response.error === 'popup_closed_by_user') {
              alert('You closed the Google sign-in popup. Please try again.')
            } else if (response.error !== 'access_denied') {
              alert(`Google authentication failed: ${response.error}. Please try again.`)
            }
            setIsLoading(false)
            reject(new Error(response.error))
            return
          }

          const expiresIn = response.expires_in ? Number(response.expires_in) : 3600
          const expiryTime = Date.now() + expiresIn * 1000

          setCachedToken(response.access_token)
          setTokenExpiry(expiryTime)
          setServerToken(response.access_token)
          hasRequestedConsentRef.current = true

          await syncTokenWithServer(response.access_token, expiresIn, response.scope)

          createAndShowPicker(response.access_token, apiKey)
          resolve(response.access_token)
        },
      })

      const requestConfig: Record<string, string> = {
        prompt: hasRequestedConsentRef.current ? '' : 'consent',
      }

      try {
        client.requestAccessToken(requestConfig)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to request access token'))
      }
    })
  }

  const openPicker = async () => {
    if (!isPickerLoaded || !window.google) {
      alert('Google Picker is not ready. Please refresh the page and try again.')
      return
    }

    setIsLoading(true)

    try {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY

      if (!apiKey) {
        throw new Error('Google API Key not configured')
      }

      const now = Date.now()

      if (cachedToken && tokenExpiry && tokenExpiry > now) {
        createAndShowPicker(cachedToken, apiKey)
        return
      }

      if (!isTokenClientReady) {
        alert('Google authentication is not ready yet. Please wait a moment and try again.')
        setIsLoading(false)
        return
      }

      try {
        await requestClientToken(apiKey)
        return
      } catch (error) {
        // Client token request failed
      }

      alert('Unable to authenticate with Google Drive. Please reconnect and try again.')
      setIsLoading(false)
    } catch (error) {
      alert('Failed to open Google Drive picker. Please try again.')
      setIsLoading(false)
    }
  }

  const createAndShowPicker = (accessToken: string, apiKey: string) => {
    if (window.gapi?.client?.setToken) {
      window.gapi.client.setToken({ access_token: accessToken })
    }

    if ((window.gapi as any)?.auth?.setToken) {
      ;(window.gapi as any).auth.setToken({ access_token: accessToken })
    }

    const supportedMimeTypes = getSupportedMimeTypes(ragProvider)

    const pickerBuilder = new window.google!.picker.PickerBuilder()
      .addView(
        new window.google!.picker.DocsView()
          .setMimeTypes(supportedMimeTypes.join(','))
      )
      .addView(
        new window.google!.picker.DocsView(window.google!.picker.ViewId.PDFS)
      )
      .addView(
        new window.google!.picker.DocsView(window.google!.picker.ViewId.DOCUMENTS)
      )
      .addView(
        new window.google!.picker.DocsView(window.google!.picker.ViewId.SPREADSHEETS)
      )
      .addView(
        new window.google!.picker.DocsView(window.google!.picker.ViewId.PRESENTATIONS)
      )
      .enableFeature(window.google!.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(window.google!.picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setCallback((data: any) => {
        if (data.action === window.google!.picker.Action.PICKED) {
          const files: PickedFile[] = data.docs.map((doc: any) => ({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType,
            iconUrl: doc.iconUrl,
            url: doc.url,
            resourceKey: doc.resourceKey,
          }))
          onFilesSelected(files)
        }
        if (data.action === window.google!.picker.Action.CANCEL ||
            data.action === window.google!.picker.Action.PICKED) {
          setIsLoading(false)
        }
      })

    if (googleAppId) {
      pickerBuilder.setAppId(googleAppId)
    }

    const origin = process.env.NEXT_PUBLIC_GOOGLE_PICKER_ORIGIN || `${window.location.protocol}//${window.location.host}`
    pickerBuilder.setOrigin(origin)

    const relayUrl = process.env.NEXT_PUBLIC_GOOGLE_PICKER_RELAY_URL || `${window.location.origin}/_/relay.html`
    pickerBuilder.setRelayUrl(relayUrl)

    pickerBuilder.build().setVisible(true)
  }

  return (
    <Button
      onClick={openPicker}
      disabled={disabled || isLoading || !isPickerLoaded}
      variant={variant}
      className={className}
    >
      {isLoading ? 'Loading...' : buttonText}
    </Button>
  )
}
