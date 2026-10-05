'use client'

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Shield, ShieldCheck, ShieldOff, Copy, Download, AlertTriangle, CheckCircle2, Loader2, RefreshCw, ExternalLink } from 'lucide-react'

interface VaultConnection {
  agentTitle: string
  connectionId: string
  provider: string
  label: string | null
  authType: string | null
  vaultKeyName: string
}

interface VaultChannel {
  channelId: string
  platform: string
  agentTitle: string | null
  vaultKeyName: string
}

const VAULT_HELP_URLS: Record<string, string> = {
  en: 'https://support.aitalk.ch/english/security/secret-vault',
  de: 'https://support.aitalk.ch/german/sicherheit/secret-vault',
  fr: 'https://support.aitalk.ch/french/securite/secret-vault',
  es: 'https://support.aitalk.ch/spanish/seguridad/secret-vault',
  ko: 'https://support.aitalk.ch/korean/security/secret-vault',
}

interface SecretVaultSectionProps {
  t: (key: string) => string
  language?: string
}

export default function SecretVaultSection({ t, language = 'en' }: SecretVaultSectionProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [vaultEnabled, setVaultEnabled] = useState(false)
  const [vaultUrl, setVaultUrl] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [connections, setConnections] = useState<VaultConnection[]>([])
  const [channels, setChannels] = useState<VaultChannel[]>([])

  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDisabling, setIsDisabling] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  const [editUrl, setEditUrl] = useState('')
  const [editToken, setEditToken] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  const loadVaultSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/settings/secret-vault')
      if (response.ok) {
        const data = await response.json()
        setVaultEnabled(data.vaultEnabled)
        setVaultUrl(data.vaultUrl || '')
        setConnections(data.connections || [])
        setChannels(data.channels || [])
      }
    } catch (error) {
      console.error('Failed to load vault settings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVaultSettings()
  }, [loadVaultSettings])

  const generateToken = useCallback(() => {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    const token = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
    if (isEditing) {
      setEditToken(token)
    } else {
      setAuthToken(token)
    }
  }, [isEditing])

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Copied!')
      setIsError(false)
      setTimeout(() => setMessage(''), 2000)
    } catch {
      // fallback
    }
  }, [])

  const testConnection = useCallback(async () => {
    const url = isEditing ? editUrl : vaultUrl
    const token = isEditing ? editToken : authToken
    if (!url || !token) return

    setIsTesting(true)
    setMessage('')
    try {
      const response = await fetch('/api/settings/secret-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', url, authToken: token }),
      })
      const data = await response.json()
      if (data.success) {
        setMessage(t('vault_test_success'))
        setIsError(false)
      } else {
        setMessage(`${t('vault_test_failed')}: ${data.error}`)
        setIsError(true)
      }
    } catch {
      setMessage(t('vault_test_failed'))
      setIsError(true)
    } finally {
      setIsTesting(false)
    }
  }, [isEditing, editUrl, editToken, vaultUrl, authToken, t])

  const saveVault = useCallback(async () => {
    const url = isEditing ? editUrl : vaultUrl
    const token = isEditing ? editToken : authToken
    if (!url || !token) return

    setIsSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/settings/secret-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, authToken: token }),
      })
      const data = await response.json()
      if (data.success) {
        setMessage(t('vault_save_success'))
        setIsError(false)
        setVaultEnabled(true)
        setVaultUrl(url)
        setAuthToken('')
        setEditUrl('')
        setEditToken('')
        setIsEditing(false)
      } else {
        setMessage(data.error || t('vault_save_error'))
        setIsError(true)
      }
    } catch {
      setMessage(t('vault_save_error'))
      setIsError(true)
    } finally {
      setIsSaving(false)
    }
  }, [isEditing, editUrl, editToken, vaultUrl, authToken, t])

  const disableVault = useCallback(async () => {
    setIsDisabling(true)
    setMessage('')
    try {
      const response = await fetch('/api/settings/secret-vault', { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setMessage(t('vault_disable_success'))
        setIsError(false)
        setVaultEnabled(false)
      } else {
        setMessage(t('vault_disable_error'))
        setIsError(true)
      }
    } catch {
      setMessage(t('vault_disable_error'))
      setIsError(true)
    } finally {
      setIsDisabling(false)
    }
  }, [t])

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const currentUrl = isEditing ? editUrl : vaultUrl
  const currentToken = isEditing ? editToken : authToken

  return (
    <div className="space-y-4">
      {/* Main Vault Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            {t('vault_title')}
          </CardTitle>
          <CardDescription>
            {t('vault_description')}{' '}
            <a
              href={VAULT_HELP_URLS[language] || VAULT_HELP_URLS.en}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('vault_help_link')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status */}
          <div className="flex items-center gap-3">
            {vaultEnabled ? (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                {t('vault_enabled')}
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1">
                <ShieldOff className="h-3 w-3" />
                {t('vault_disabled')}
              </Badge>
            )}
          </div>

          {/* Message */}
          {message && (
            <div className={`p-3 rounded-md text-sm flex items-center gap-2 ${
              isError
                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                : 'bg-green-500/10 text-green-500 border border-green-500/20'
            }`}>
              {isError ? <AlertTriangle className="h-4 w-4 flex-shrink-0" /> : <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
              {message}
            </div>
          )}

          {/* Active Vault — Show URL & controls */}
          {vaultEnabled && !isEditing && (
            <div className="space-y-4">
              <div className="p-4 border rounded-lg bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                <p className="text-sm font-medium mb-1">{t('vault_url_label')}</p>
                <p className="text-sm text-muted-foreground font-mono break-all">{vaultUrl}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(true)
                    setEditUrl(vaultUrl)
                    setEditToken('')
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Update
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={disableVault}
                  disabled={isDisabling}
                >
                  {isDisabling && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {t('vault_disable')}
                </Button>
              </div>
            </div>
          )}

          {/* Setup / Edit Form */}
          {(!vaultEnabled || isEditing) && (
            <div className="space-y-4">
              {/* Warning */}
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{t('vault_warning_title')}</p>
                    <p className="text-sm text-amber-600/80 dark:text-amber-400/80 mt-1">{t('vault_warning_text')}</p>
                  </div>
                </div>
              </div>

              {/* Lambda URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('vault_url_label')}</label>
                <Input
                  value={currentUrl}
                  onChange={(e) => isEditing ? setEditUrl(e.target.value) : setVaultUrl(e.target.value)}
                  placeholder={t('vault_url_placeholder')}
                  autoComplete="off"
                />
              </div>

              {/* Auth Token */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('vault_auth_token_label')}</label>
                <div className="flex gap-2">
                  <Input
                    value={currentToken}
                    onChange={(e) => isEditing ? setEditToken(e.target.value) : setAuthToken(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    autoComplete="new-password"
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="sm" onClick={generateToken} className="shrink-0">
                    {t('vault_auth_token_generate')}
                  </Button>
                  {currentToken && (
                    <Button variant="ghost" size="sm" onClick={() => copyToClipboard(currentToken)} className="shrink-0">
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('vault_auth_token_help')}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={testConnection}
                  disabled={!currentUrl || !currentToken || isTesting}
                >
                  {isTesting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {t('vault_test_connection')}
                </Button>
                <Button
                  size="sm"
                  onClick={saveVault}
                  disabled={!currentUrl || !currentToken || isSaving}
                >
                  {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  {t('vault_save')}
                </Button>
                {isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false)
                      setEditUrl('')
                      setEditToken('')
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              {/* Lambda Template Download */}
              <div className="pt-2 border-t">
                <a
                  href="/templates/secret-vault-lambda.js"
                  download="secret-vault-lambda.js"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <Download className="h-4 w-4" />
                  {t('vault_download_template')}
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connection Reference */}
      {(connections.length > 0 || channels.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('vault_connections_title')}</CardTitle>
            <CardDescription>{t('vault_connections_description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium">{t('vault_connections_agent')}</th>
                    <th className="text-left py-2 pr-4 font-medium">{t('vault_connections_provider')}</th>
                    <th className="text-left py-2 font-medium">{t('vault_connections_key_name')}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* AI Provider Keys */}
                  <tr className="border-b">
                    <td className="py-2 pr-4 text-muted-foreground">—</td>
                    <td className="py-2 pr-4">AI Providers</td>
                    <td className="py-2 font-mono text-xs">
                      <span className="text-muted-foreground">ai_provider_{'{'}<em>provider</em>{'}'}_api_key</span>
                      <button
                        onClick={() => copyToClipboard('ai_provider_openai_api_key')}
                        className="ml-2 text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="h-3 w-3 inline" />
                      </button>
                    </td>
                  </tr>

                  {/* Workflow Connections */}
                  {connections.map((conn) => (
                    <tr key={conn.connectionId} className="border-b">
                      <td className="py-2 pr-4">{conn.agentTitle}</td>
                      <td className="py-2 pr-4">
                        {conn.provider}
                        {conn.authType === 'oauth' && (
                          <Badge variant="outline" className="ml-2 text-xs">OAuth</Badge>
                        )}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        {conn.authType === 'oauth' ? (
                          <span className="text-muted-foreground italic">(OAuth — DB only)</span>
                        ) : (
                          <>
                            {conn.vaultKeyName}
                            <button
                              onClick={() => copyToClipboard(conn.vaultKeyName)}
                              className="ml-2 text-muted-foreground hover:text-foreground"
                            >
                              <Copy className="h-3 w-3 inline" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* Bot Channels */}
                  {channels.map((ch) => (
                    <tr key={ch.channelId} className="border-b">
                      <td className="py-2 pr-4">{ch.agentTitle || '—'}</td>
                      <td className="py-2 pr-4">{ch.platform} bot</td>
                      <td className="py-2 font-mono text-xs">
                        {ch.vaultKeyName}
                        <button
                          onClick={() => copyToClipboard(ch.vaultKeyName.split(',')[0].trim())}
                          className="ml-2 text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="h-3 w-3 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground mt-3">{t('vault_connections_oauth_note')}</p>
          </CardContent>
        </Card>
      )}

      {connections.length === 0 && channels.length === 0 && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground text-center">{t('vault_no_connections')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
