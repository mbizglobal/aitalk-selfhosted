'use client'

import { useState, useEffect, useCallback } from 'react'
import { useEdition } from '@/components/EditionProvider'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Plug, Copy, CheckCircle2, Trash2, Loader2, KeyRound, ExternalLink, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { countryFlagEmoji, countryName } from '@/lib/country-display'

interface McpToken {
  id: string
  name: string
  tokenPrefix: string
  scopes: string
  lastUsedAt: string | null
  lastUsedIp: string | null
  lastUsedCountry: string | null
  createdAt: string
}

const MCP_HELP_URLS: Record<string, string> = {
  en: 'https://support.aitalk.ch/english/mcp/mcp-server',
  de: 'https://support.aitalk.ch/german/mcp/mcp-server',
  fr: 'https://support.aitalk.ch/french/mcp/mcp-server',
  ko: 'https://support.aitalk.ch/korean/mcp/mcp-server',
}

interface McpSectionProps {
  t: (key: string) => string
  language?: string
}

export default function McpSection({ t, language = 'en' }: McpSectionProps) {
  const [tokens, setTokens] = useState<McpToken[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [withWrite, setWithWrite] = useState(true)
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [selectedClient, setSelectedClient] = useState<'claude' | 'claude-desktop' | 'codex' | 'antigravity'>('claude')

  const serverUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp-server` : 'https://www.aitalk.ch/api/mcp-server'
  const tokenValue = createdToken ?? '<YOUR_TOKEN>'

  const clients: Array<{ id: 'claude' | 'claude-desktop' | 'codex' | 'antigravity'; label: string; hintKey: string; snippet: string }> = [
    {
      id: 'claude',
      label: 'Claude Code',
      hintKey: 'mcp_connect_claude_hint',
      snippet: `claude mcp add --transport http aitalk ${serverUrl} --header "Authorization: Bearer ${tokenValue}"`,
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      hintKey: 'mcp_connect_claude_desktop_hint',
      snippet: `{\n  "mcpServers": {\n    "aitalk": {\n      "command": "npx",\n      "args": ["-y", "mcp-remote", "${serverUrl}", "--header", "Authorization: Bearer ${tokenValue}"]\n    }\n  }\n}`,
    },
    {
      id: 'codex',
      label: 'Codex',
      hintKey: 'mcp_connect_codex_hint',
      snippet: `[mcp_servers.aitalk]\nurl = "${serverUrl}"\nhttp_headers = { "Authorization" = "Bearer ${tokenValue}" }`,
    },
    {
      id: 'antigravity',
      label: 'Antigravity',
      hintKey: 'mcp_connect_antigravity_hint',
      snippet: `{\n  "mcpServers": {\n    "aitalk": {\n      "serverUrl": "${serverUrl}",\n      "headers": { "Authorization": "Bearer ${tokenValue}" }\n    }\n  }\n}`,
    },
  ]
  const activeClient = clients.find((c) => c.id === selectedClient) ?? clients[0]
  const edition = useEdition()
  const helpUrl = edition === 'selfhosted' ? null : MCP_HELP_URLS[language] || MCP_HELP_URLS.en

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/mcp-tokens')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const data = await res.json()
      setTokens(data.tokens || [])
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadTokens() }, [loadTokens])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    setError('')
    try {
      const res = await fetch('/api/settings/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), scopes: withWrite ? 'read write' : 'read' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'token_limit_reached' ? t('mcp_token_limit_reached') : t('mcp_create_failed'))
        return
      }
      setCreatedToken(data.token)
      setNewName('')
      await loadTokens()
    } catch {
      setError(t('mcp_create_failed'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(t('mcp_revoke_confirm').replace('{name}', name))) return
    const res = await fetch('/api/settings/mcp-tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      setTokens(tokens.filter(tk => tk.id !== id))
    }
  }

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            {t('mcp_title')}
          </CardTitle>
          <CardDescription>
            {t('mcp_description')}{' '}
            {helpUrl && (
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('mcp_help_link')}
              <ExternalLink className="h-3 w-3" />
            </a>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isLoading && !loadError && tokens.length === 0 && (
            <div className="rounded-md border bg-muted/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <p className="text-sm font-medium">{t('mcp_intro_title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">{t('mcp_intro_body')}</p>
              <p className="text-sm text-muted-foreground">{t('mcp_intro_why')}</p>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
                <li>{t('mcp_intro_step1')}</li>
                <li>{t('mcp_intro_step2')}</li>
                <li>{t('mcp_intro_step3')}</li>
              </ol>
              <p className="text-xs text-muted-foreground">{t('mcp_intro_note')}</p>
              {helpUrl && (
              <a
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t('mcp_help_link')}
                <ExternalLink className="h-3 w-3" />
              </a>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('mcp_token_name_placeholder')}
              maxLength={100}
              autoComplete="off"
              className="max-w-sm"
            />
            <Button onClick={handleCreate} disabled={isCreating || !newName.trim()}>
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" />}
              {t('mcp_create_token')}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={withWrite}
              onChange={(e) => setWithWrite(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            {t('mcp_scope_write_label')}
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}

          {createdToken && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
              <p className="text-sm font-medium">{t('mcp_token_created_note')}</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded break-all flex-1">{createdToken}</code>
                <Button variant="outline" size="sm" onClick={() => handleCopy(createdToken, 'token')}>
                  {copied === 'token' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{t('mcp_load_failed')}</p>
              <Button variant="outline" size="sm" onClick={() => { setIsLoading(true); loadTokens() }}>
                {t('mcp_load_retry')}
              </Button>
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('mcp_no_tokens')}</p>
          ) : (
            <div className="space-y-2">
              {tokens.map(tk => (
                <div key={tk.id} className="flex items-center justify-between rounded-md border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{tk.name}</span>
                      <Badge variant="secondary" className="text-xs">{tk.scopes}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <code>{tk.tokenPrefix}</code>
                      {' · '}
                      {tk.lastUsedAt
                        ? `${t('mcp_last_used')}: ${new Date(tk.lastUsedAt).toLocaleString()}`
                        : t('mcp_never_used')}
                      {tk.lastUsedIp && (
                        <>
                          {' · '}
                          {tk.lastUsedCountry && (
                            <>{countryFlagEmoji(tk.lastUsedCountry)} {countryName(tk.lastUsedCountry, language)} </>
                          )}
                          <span className="font-mono">{tk.lastUsedIp}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRevoke(tk.id, tk.name)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('mcp_connect_title')}</CardTitle>
          <CardDescription>{t('mcp_connect_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap rounded-lg bg-muted p-1 gap-1">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedClient(c.id)}
                className={cn(
                  'px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                  selectedClient === c.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {c.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{t(activeClient.hintKey)}</p>
          <div className="flex items-start gap-2">
            <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto flex-1 whitespace-pre-wrap break-all">{activeClient.snippet}</pre>
            <Button variant="outline" size="sm" onClick={() => handleCopy(activeClient.snippet, `snippet-${activeClient.id}`)}>
              {copied === `snippet-${activeClient.id}` ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
