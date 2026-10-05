'use client'

import React, { useState, useEffect, useCallback } from 'react'
import type { Node } from 'reactflow'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { Input } from '@/components/ui/input'
import {
  Plus,
  Trash2,
  Globe,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Shield,
  Key,
} from 'lucide-react'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HTTP_PRESETS, getPresetById, getPresetBaseUrl } from '@/lib/workflow/nodes/http-request-presets'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const AUTH_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'apiKey', label: 'API Key (Header)' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'hmac', label: 'HMAC SHA256' },
] as const

const MULTI_ONLY_AUTH_TYPES = ['hmac']

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-400',
  POST: 'text-blue-400',
  PUT: 'text-yellow-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
}

export const HttpRequestPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { agent, ui } = useWorkflowContext()

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDevInfo, setShowDevInfo] = useState(false)
  const [newEnvName, setNewEnvName] = useState('')
  const [isAddingEnv, setIsAddingEnv] = useState(false)
  const [editingRequestIndex, setEditingRequestIndex] = useState<number | null>(null)
  const [showSingleEdit, setShowSingleEdit] = useState(false)

  const [credentialStatus, setCredentialStatus] = useState<{
    hasCredentials: boolean
    authType?: string
    authHeaderName?: string
  }>({
    hasCredentials: !!node.data.httpConnectionId,
    authType: node.data.httpConnectionId ? (node.data.authType || 'none') : undefined,
  })
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [isEditingCredentials, setIsEditingCredentials] = useState(false)

  const fetchCredentialStatus = useCallback(async () => {
    if (!agent.agentId || !node.id) return
    try {
      const res = await fetch(`/api/agent-studio/http-request-auth?agentId=${agent.agentId}&nodeId=${node.id}`)
      if (res.ok) {
        const data = await res.json()
        setCredentialStatus(data)
        if (data.hasCredentials) {
          if (!node.data.httpConnectionId) {
            updateNodeData({ httpConnectionId: node.id })
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch credential status:', error)
    }
  }, [agent.agentId, node.id])

  useEffect(() => {
    fetchCredentialStatus()
  }, [fetchCredentialStatus])

  const saveCredentials = async () => {
    if (!agent.agentId || !node.id) return
    const authType = node.data.authType || 'none'
    if (authType === 'none') return

    setCredentialSaving(true)
    try {
      const credentials: Record<string, string> = { authType }
      if (authType === 'apiKey') {
        credentials.authHeaderName = node.data.authHeaderName || 'Authorization'
        credentials.authHeaderValue = node.data.authHeaderValue || ''
      } else if (authType === 'bearer') {
        credentials.bearerToken = node.data.bearerToken || ''
      } else if (authType === 'basic') {
        credentials.basicUser = node.data.basicUser || ''
        credentials.basicPassword = node.data.basicPassword || ''
      } else if (authType === 'hmac') {
        credentials.hmacApiKey = node.data.hmacApiKey || ''
        credentials.hmacSecret = node.data.hmacSecret || ''
      }

      const res = await fetch('/api/agent-studio/http-request-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent.agentId,
          nodeId: node.id,
          credentials,
        }),
      })

      if (res.ok) {
        updateNodeData({
          httpConnectionId: node.id,
          authHeaderValue: '',
          bearerToken: '',
          basicUser: '',
          basicPassword: '',
          hmacApiKey: '',
          hmacSecret: '',
        })
        setCredentialStatus({ hasCredentials: true, authType, authHeaderName: credentials.authHeaderName })
        setIsEditingCredentials(false)
      }
    } catch (error) {
      console.error('Failed to save credentials:', error)
    } finally {
      setCredentialSaving(false)
    }
  }

  const deleteCredentials = async () => {
    if (!agent.agentId || !node.id) return

    setCredentialLoading(true)
    try {
      const res = await fetch(`/api/agent-studio/http-request-auth?agentId=${agent.agentId}&nodeId=${node.id}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        updateNodeData({ httpConnectionId: '' })
        setCredentialStatus({ hasCredentials: false })
        setIsEditingCredentials(false)
      }
    } catch (error) {
      console.error('Failed to delete credentials:', error)
    } finally {
      setCredentialLoading(false)
    }
  }

  const mode = node.data.mode || 'single'
  const preset = node.data.preset || 'direct'
  const authType = node.data.authType || 'none'
  const authHeaderName = node.data.authHeaderName || 'Authorization'
  const authHeaderValue = node.data.authHeaderValue || ''
  const bearerToken = node.data.bearerToken || ''
  const basicUser = node.data.basicUser || ''
  const basicPassword = node.data.basicPassword || ''
  const hmacApiKey = node.data.hmacApiKey || ''
  const hmacSecret = node.data.hmacSecret || ''
  const headers: Array<{ key: string; value: string }> = node.data.headers || []
  const timeout = node.data.timeout ?? 30

  const method = node.data.method || 'GET'
  const url = node.data.url || ''
  const bodyType = node.data.bodyType || 'json'
  const body = node.data.body || ''
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method)

  const baseUrl = node.data.baseUrl || ''
  const environment = node.data.environment || ''
  const customEnvironments: Array<{ name: string; url: string }> = node.data.customEnvironments || []
  const requests: Array<{
    alias: string
    method: string
    path: string
    enabled: boolean
    description?: string
    body?: string
  }> = node.data.requests || []
  const requestDelay = node.data.requestDelay ?? 0

  const isMulti = mode === 'multi'
  const currentPreset = preset !== 'direct' ? getPresetById(preset) : null
  const authTypeOptions = isMulti
    ? AUTH_TYPES
    : AUTH_TYPES.filter(a => !MULTI_ONLY_AUTH_TYPES.includes(a.value) || a.value === authType)

  const envList: Array<{ name: string; url: string }> = currentPreset?.environments
    ? currentPreset.environments.map(env => ({
        name: env,
        url: typeof currentPreset.baseUrl === 'object' ? (currentPreset.baseUrl[env] || '') : (currentPreset.baseUrl as string),
      }))
    : customEnvironments

  // ========================================
  // ========================================
  const applyPreset = (presetId: string) => {
    if (presetId === 'direct') {
      updateNodeData({
        preset: 'direct',
        mode: 'single',
        baseUrl: '',
        environment: '',
        requests: [],
        requestDelay: 0,
      })
      return
    }

    const p = getPresetById(presetId)
    if (!p) return

    updateNodeData({
      preset: presetId,
      mode: 'multi',
      baseUrl: getPresetBaseUrl(p, p.defaultEnvironment),
      environment: p.defaultEnvironment || '',
      authType: p.authType,
      authHeaderName: p.authHeaderName || '',
      authHeaderValue: '',
      basicUser: '',     // Basic Auth: API Key
      basicPassword: '', // Basic Auth: API Secret
      hmacApiKey: '',    // HMAC: API Key
      hmacSecret: '',    // HMAC: Secret Key
      requests: p.requests.map(r => ({ ...r })),
      requestDelay: 0,
    })
  }

  const changeEnvironment = (envName: string) => {
    const found = envList.find(e => e.name === envName)
    if (!found) return
    updateNodeData({
      environment: envName,
      baseUrl: found.url,
    })
  }

  const confirmAddEnvironment = () => {
    const name = newEnvName.trim()
    if (!name) return
    if (customEnvironments.some(e => e.name === name)) return
    const newEnv = { name, url: baseUrl || '' }
    const updated = [...customEnvironments, newEnv]
    updateNodeData({
      customEnvironments: updated,
      environment: name,
      baseUrl: newEnv.url,
    })
    setNewEnvName('')
    setIsAddingEnv(false)
  }

  const removeEnvironment = (envName: string) => {
    const updated = customEnvironments.filter(e => e.name !== envName)
    updateNodeData({ customEnvironments: updated })
    if (envName === environment) {
      if (updated.length > 0) {
        updateNodeData({ environment: updated[0].name, baseUrl: updated[0].url, customEnvironments: updated })
      } else {
        updateNodeData({ environment: '', customEnvironments: updated })
      }
    }
  }

  const handleBaseUrlChange = (newUrl: string) => {
    if (!currentPreset && environment && customEnvironments.length > 0) {
      const updated = customEnvironments.map(e =>
        e.name === environment ? { ...e, url: newUrl } : e
      )
      updateNodeData({ baseUrl: newUrl, customEnvironments: updated })
    } else {
      updateNodeData({ baseUrl: newUrl })
    }
  }

  // ========================================
  // ========================================
  const toggleRequest = (index: number) => {
    const updated = [...requests]
    updated[index] = { ...updated[index], enabled: !updated[index].enabled }
    updateNodeData({ requests: updated })
  }

  const newRequest = (existing: typeof requests) => {
    const used = new Set(existing.map(r => (typeof r?.alias === 'string' ? r.alias.trim() : '')))
    let n = existing.length + 1
    while (used.has(`request${n}`)) n++
    return { alias: `request${n}`, method: 'GET', path: '/', enabled: true }
  }

  const addCustomRequest = () => {
    updateNodeData({ requests: [...requests, newRequest(requests)] })
  }

  const removeRequest = (index: number) => {
    updateNodeData({ requests: requests.filter((_, i) => i !== index) })
  }

  const updateRequest = (index: number, field: string, val: any) => {
    const updated = [...requests]
    updated[index] = { ...updated[index], [field]: val }
    updateNodeData({ requests: updated })
  }

  // ========================================
  // ========================================
  const addHeader = () => {
    updateNodeData({ headers: [...headers, { key: '', value: '' }] })
  }
  const removeHeader = (index: number) => {
    updateNodeData({ headers: headers.filter((_, i) => i !== index) })
  }
  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...headers]
    updated[index] = { ...updated[index], [field]: val }
    updateNodeData({ headers: updated })
  }

  // ========================================
  // Render
  // ========================================
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">
          {t.httpRequest || 'HTTP Request'}
        </h3>
      </div>

      {/* Service Selector */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-200">
          {t.httpRequestService || 'Service'}
        </label>
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-md border border-[#3A3A3A] bg-[#1A1A1A] text-gray-200 focus:outline-none focus:border-orange-500"
        >
          <option value="direct">{t.httpRequestDirectInput || 'Direct Input'}</option>
          {HTTP_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {currentPreset && (
          <p className="text-xs text-orange-400/70">
            {t.httpRequestPresetApplied || 'Preset applied. You can modify settings freely.'}
          </p>
        )}
      </div>

      {preset === 'direct' && (
        <div className="flex gap-2">
          <button
            onClick={() => updateNodeData({ mode: 'single' })}
            className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
              !isMulti
                ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                : 'border-[#3A3A3A] bg-[#2A2A2A] text-gray-400 hover:text-gray-200'
            }`}
          >
            Single URL
          </button>
          <button
            onClick={() => updateNodeData({
              mode: 'multi',
              baseUrl: baseUrl || '',
              requests: requests.length > 0 ? requests : [newRequest([])],
            })}
            className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-colors ${
              isMulti
                ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                : 'border-[#3A3A3A] bg-[#2A2A2A] text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.httpRequestMultiUrl || 'Multi-URL'}
          </button>
        </div>
      )}

      {!isMulti && (
        <>
          <div
            onClick={() => setShowSingleEdit(true)}
            className="p-2.5 rounded-lg border border-[#3A3A3A] bg-[#1A1A1A] cursor-pointer hover:border-orange-500/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-bold ${METHOD_COLORS[method] || 'text-gray-200'}`}>{method}</span>
              <span className="text-xs font-mono text-gray-200 truncate flex-1">
                {url || 'https://...'}
              </span>
            </div>
            {hasBody && bodyType !== 'none' && (
              <p className="text-xs text-gray-500 mt-1 ml-0 truncate">
                Body: {bodyType.toUpperCase()}
              </p>
            )}
          </div>

          <Dialog open={showSingleEdit} onOpenChange={setShowSingleEdit}>
            <DialogContent className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Request</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Method */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Method</label>
                  <select
                    value={method}
                    onChange={(e) => updateNodeData({ method: e.target.value })}
                    className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-md border border-[#3A3A3A] bg-[#2A2A2A] ${METHOD_COLORS[method] || 'text-gray-200'} focus:outline-none focus:border-orange-500`}
                  >
                    {HTTP_METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                {/* URL */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">URL</label>
                  <textarea
                    value={url}
                    onChange={(e) => updateNodeData({ url: e.target.value })}
                    placeholder="https://api.example.com/v1/data"
                    rows={3}
                    className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 text-sm font-mono resize-y focus:outline-none focus:border-orange-500"
                    spellCheck={false}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {t.httpRequestUrlHint || 'Supports {{context.xxx}} template variables'}
                  </p>
                </div>
                {/* Body Type + Body (POST/PUT/PATCH only) */}
                {hasBody && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-xs text-gray-400">Body Type</label>
                      <select
                        value={bodyType}
                        onChange={(e) => updateNodeData({ bodyType: e.target.value })}
                        className="px-2 py-0.5 text-xs rounded border border-[#3A3A3A] bg-[#2A2A2A] text-gray-300 focus:outline-none"
                      >
                        <option value="json">JSON</option>
                        <option value="text">Text</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    {bodyType !== 'none' && (
                      <textarea
                        value={body}
                        onChange={(e) => updateNodeData({ body: e.target.value })}
                        placeholder={bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Request body...'}
                        rows={5}
                        className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 text-sm font-mono resize-y focus:outline-none focus:border-orange-500"
                        spellCheck={false}
                      />
                    )}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {isMulti && (
        <>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-200">
                {t.httpRequestEnvironment || 'Environment'}
              </label>
              {!currentPreset && !isAddingEnv && (
                <button
                  onClick={() => setIsAddingEnv(true)}
                  className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              )}
            </div>

            {envList.length > 0 ? (
              <div className="flex gap-2 flex-wrap">
                {envList.map((env) => (
                  <div key={env.name} className="relative group">
                    <button
                      onClick={() => changeEnvironment(env.name)}
                      className={`px-3 py-1.5 text-xs rounded-md border transition-colors capitalize ${
                        environment === env.name
                          ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                          : 'border-[#3A3A3A] bg-[#2A2A2A] text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {env.name}
                    </button>
                    {!currentPreset && (
                      <button
                        onClick={(e) => { e.stopPropagation(); removeEnvironment(env.name) }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#2A2A2A] border border-[#3A3A3A] text-gray-500 hover:text-red-400 hover:border-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <span className="text-[10px] leading-none">&times;</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                No environments. Base URL is used directly.
              </p>
            )}

            {isAddingEnv && (
              <div className="flex gap-1.5 items-center">
                <Input
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmAddEnvironment(); if (e.key === 'Escape') { setIsAddingEnv(false); setNewEnvName('') } }}
                  placeholder="Name (e.g. demo)"
                  className="w-[120px] bg-[#2A2A2A] border-orange-500/50 text-gray-200 text-xs px-2 py-1 h-7"
                  autoComplete="off"
                  autoFocus
                />
                <button
                  onClick={confirmAddEnvironment}
                  className="px-2 py-1 text-xs rounded bg-orange-500/20 border border-orange-500/50 text-orange-300 hover:bg-orange-500/30 transition-colors h-7"
                >
                  OK
                </button>
                <button
                  onClick={() => { setIsAddingEnv(false); setNewEnvName('') }}
                  className="px-2 py-1 text-xs rounded border border-[#3A3A3A] text-gray-400 hover:text-gray-200 transition-colors h-7"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-200">
              {t.httpRequestBaseUrl || 'Base URL'}
            </label>
            <Input
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm"
              autoComplete="off"
            />
          </div>

          {/* Requests List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-200">
                {t.httpRequestRequests || 'Requests'}
                <span className="text-gray-500 text-xs ml-1">
                  ({requests.filter(r => r.enabled).length}/{requests.length})
                </span>
              </label>
              <button
                onClick={addCustomRequest}
                className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {t.httpRequestAddRequest || 'Add'}
              </button>
            </div>

            {requests.map((req, i) => (
              <div
                key={i}
                onClick={() => setEditingRequestIndex(i)}
                className={`p-2.5 rounded-lg border transition-colors cursor-pointer hover:border-orange-500/50 ${
                  req.enabled
                    ? 'border-[#3A3A3A] bg-[#1A1A1A]'
                    : 'border-[#2A2A2A] bg-[#1A1A1A]/50 opacity-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={req.enabled}
                    onChange={(e) => { e.stopPropagation(); toggleRequest(i) }}
                    className="w-3.5 h-3.5 rounded accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-gray-200 truncate flex-1">{req.alias || 'alias'}</span>
                  {req.signed && <Shield className="w-3 h-3 text-yellow-400 shrink-0" title={t.httpRequestSigned || 'Signed'} />}
                  <span className={`text-xs font-mono font-bold ${METHOD_COLORS[req.method] || 'text-gray-200'}`}>{req.method}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeRequest(i) }}
                    className="text-gray-500 hover:text-red-400 transition-colors p-0.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 font-mono mt-1 ml-6 truncate">{req.path || '/path'}</p>
              </div>
            ))}

            {/* Request Edit Dialog */}
            {editingRequestIndex !== null && requests[editingRequestIndex] && (
              <Dialog open={true} onOpenChange={() => setEditingRequestIndex(null)}>
                <DialogContent className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Edit Request</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    {/* Alias */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Alias</label>
                      <Input
                        value={requests[editingRequestIndex].alias}
                        onChange={(e) => updateRequest(editingRequestIndex, 'alias', e.target.value)}
                        placeholder="alias"
                        className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm font-mono"
                        autoComplete="off"
                      />
                    </div>
                    {/* Method */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Method</label>
                      <select
                        value={requests[editingRequestIndex].method}
                        onChange={(e) => updateRequest(editingRequestIndex, 'method', e.target.value)}
                        className={`w-full px-3 py-2 text-sm font-mono font-bold rounded-md border border-[#3A3A3A] bg-[#2A2A2A] ${METHOD_COLORS[requests[editingRequestIndex].method] || 'text-gray-200'} focus:outline-none focus:border-orange-500`}
                      >
                        {HTTP_METHODS.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    {/* Path */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Path</label>
                      <textarea
                        value={requests[editingRequestIndex].path}
                        onChange={(e) => updateRequest(editingRequestIndex, 'path', e.target.value)}
                        placeholder="/path?param=value"
                        rows={3}
                        className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 text-sm font-mono resize-y focus:outline-none focus:border-orange-500"
                        spellCheck={false}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {t.httpRequestUrlHint || 'Supports {{context.xxx}} template variables'}
                      </p>
                    </div>
                    {/* Body (POST/PUT/PATCH) */}
                    {['POST', 'PUT', 'PATCH'].includes(requests[editingRequestIndex].method) && (
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Body (JSON)</label>
                        <textarea
                          value={requests[editingRequestIndex].body || ''}
                          onChange={(e) => updateRequest(editingRequestIndex, 'body', e.target.value)}
                          placeholder={'{\n  "key": "value"\n}'}
                          rows={4}
                          className="w-full px-3 py-2 border border-[#3A3A3A] rounded-md bg-[#2A2A2A] text-gray-200 text-sm font-mono resize-y focus:outline-none focus:border-orange-500"
                          spellCheck={false}
                        />
                      </div>
                    )}
                    {authType === 'hmac' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!requests[editingRequestIndex].signed}
                          onChange={(e) => updateRequest(editingRequestIndex, 'signed', e.target.checked)}
                          className="w-3.5 h-3.5 rounded accent-orange-500 cursor-pointer"
                          id="signed-checkbox"
                        />
                        <label htmlFor="signed-checkbox" className="text-xs text-gray-300 cursor-pointer flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5 text-yellow-400" />
                          {t.httpRequestSigned || 'Signed'}
                        </label>
                        <span className="text-xs text-gray-500">
                          {t.httpRequestSignedHint || 'Requires HMAC-SHA256 signature'}
                        </span>
                      </div>
                    )}
                    {/* Description */}
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Description (optional)</label>
                      <Input
                        value={requests[editingRequestIndex].description || ''}
                        onChange={(e) => updateRequest(editingRequestIndex, 'description', e.target.value)}
                        placeholder="What this request does"
                        className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </>
      )}

      <div className="space-y-3 p-3 bg-[#1A1A1A] rounded-lg border border-[#3A3A3A]">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-200">
            {t.httpRequestAuth || 'Authentication'}
          </label>
          {credentialStatus.hasCredentials && !isEditingCredentials && (
            <div className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs text-green-400">Encrypted</span>
            </div>
          )}
        </div>

        {credentialStatus.hasCredentials && !isEditingCredentials ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2.5 bg-[#2A2A2A] rounded-md border border-green-500/20">
              <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200">
                  {AUTH_TYPES.find(a => a.value === credentialStatus.authType)?.label || credentialStatus.authType}
                </p>
                <p className="text-xs text-gray-500">
                  {t.httpRequestCredentialsSaved || 'Credentials saved (encrypted)'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditingCredentials(true)}
                className="flex-1 px-3 py-1.5 text-xs rounded-md border border-[#3A3A3A] bg-[#2A2A2A] text-gray-300 hover:text-gray-100 hover:border-orange-500/50 transition-colors"
              >
                {t.httpRequestChangeCredentials || 'Change'}
              </button>
              <button
                onClick={deleteCredentials}
                disabled={credentialLoading}
                className="flex-1 px-3 py-1.5 text-xs rounded-md border border-[#3A3A3A] bg-[#2A2A2A] text-red-400 hover:text-red-300 hover:border-red-500/50 transition-colors disabled:opacity-50"
              >
                {credentialLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                ) : (
                  t.httpRequestDeleteCredentials || 'Delete'
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {preset && preset !== 'direct' && getPresetById(preset)?.authType ? (
              <div className="px-3 py-2 text-sm rounded-md border border-[#3A3A3A] bg-[#2A2A2A] text-gray-400">
                {AUTH_TYPES.find(a => a.value === authType)?.label || authType}
              </div>
            ) : (
              <select
                value={authType}
                onChange={(e) => updateNodeData({ authType: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md border border-[#3A3A3A] bg-[#2A2A2A] text-gray-200 focus:outline-none focus:border-orange-500"
              >
                {authTypeOptions.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            )}

            {/* API Key Auth */}
            {authType === 'apiKey' && (
              <div className="space-y-2">
                <Input
                  value={authHeaderName}
                  onChange={(e) => updateNodeData({ authHeaderName: e.target.value })}
                  placeholder="Authorization"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
                  autoComplete="off"
                />
                <Input
                  value={authHeaderValue}
                  onChange={(e) => updateNodeData({ authHeaderValue: e.target.value })}
                  placeholder="your-api-key"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm font-mono"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500">
                  Header name and value sent with every request
                </p>
              </div>
            )}

            {/* Bearer Token */}
            {authType === 'bearer' && (
              <div className="space-y-2">
                <Input
                  value={bearerToken}
                  onChange={(e) => updateNodeData({ bearerToken: e.target.value })}
                  placeholder="your-token"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm font-mono"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500">
                  Sent as: Authorization: Bearer {'<token>'}
                </p>
              </div>
            )}

            {/* Basic Auth */}
            {authType === 'basic' && (
              <div className="space-y-2">
                <Input
                  value={basicUser}
                  onChange={(e) => updateNodeData({ basicUser: e.target.value })}
                  placeholder={preset === 'trading212' ? 'API Key ID' : 'Username'}
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
                  autoComplete="off"
                />
                <Input
                  type="password"
                  value={basicPassword}
                  onChange={(e) => updateNodeData({ basicPassword: e.target.value })}
                  placeholder={preset === 'trading212' ? 'Secret Key' : 'Password'}
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm"
                  autoComplete="new-password"
                />
              </div>
            )}

            {/* HMAC SHA256 */}
            {authType === 'hmac' && (
              <div className="space-y-2">
                <Input
                  value={hmacApiKey}
                  onChange={(e) => updateNodeData({ hmacApiKey: e.target.value })}
                  placeholder="API Key"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm font-mono"
                  autoComplete="off"
                />
                <Input
                  type="password"
                  value={hmacSecret}
                  onChange={(e) => updateNodeData({ hmacSecret: e.target.value })}
                  placeholder="Secret Key"
                  className="bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 text-sm font-mono"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500">
                  {t.httpRequestHmacHint || 'API Key is sent as X-MBX-APIKEY header. Signed requests include HMAC-SHA256 signature.'}
                </p>
              </div>
            )}

            {authType !== 'none' && (
              <div className="flex gap-2">
                <button
                  onClick={saveCredentials}
                  disabled={credentialSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-orange-500/20 border border-orange-500/50 text-orange-300 hover:bg-orange-500/30 transition-colors disabled:opacity-50"
                >
                  {credentialSaving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Key className="w-3 h-3" />
                  )}
                  {t.httpRequestSaveCredentials || 'Save Credentials'}
                </button>
                {isEditingCredentials && (
                  <button
                    onClick={() => setIsEditingCredentials(false)}
                    className="px-3 py-1.5 text-xs rounded-md border border-[#3A3A3A] text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-200">
            {t.httpRequestHeaders || 'Headers'}
            <span className="text-gray-500 text-xs ml-1">({t.optional || 'Optional'})</span>
          </label>
          <button
            onClick={addHeader}
            className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
        {headers.map((h, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <Input
              value={h.key}
              onChange={(e) => updateHeader(i, 'key', e.target.value)}
              placeholder="Header name"
              className="w-[40%] bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 text-xs"
              autoComplete="off"
            />
            <Input
              value={h.value}
              onChange={(e) => updateHeader(i, 'value', e.target.value)}
              placeholder="Value"
              className="flex-1 bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 text-xs"
              autoComplete="off"
            />
            <button
              onClick={() => removeHeader(i)}
              className="text-gray-500 hover:text-red-400 transition-colors p-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-[#3A3A3A] pt-3">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          {t.httpRequestAdvanced || 'Advanced'}
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm text-gray-300 mb-1 block">
                {t.httpRequestTimeout || 'Timeout (seconds)'}
              </label>
              <Input
                type="number"
                value={timeout}
                onChange={(e) => updateNodeData({ timeout: parseInt(e.target.value) || 30 })}
                min={1}
                max={120}
                className="w-24 bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 text-sm"
              />
            </div>
            {isMulti && (
              <div>
                <label className="text-sm text-gray-300 mb-1 block">
                  {t.httpRequestDelay || 'Request Delay (ms)'}
                </label>
                <Input
                  type="number"
                  value={requestDelay}
                  onChange={(e) => updateNodeData({ requestDelay: parseInt(e.target.value) || 0 })}
                  min={0}
                  max={10000}
                  placeholder="0"
                  className="w-24 bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Delay between requests (Rate Limit)
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-gray-400">
            <Globe className="w-4 h-4 text-orange-400" />
            <span>
              {isMulti
                ? (t.httpRequestMultiResultInfo || 'Result: context.httpResult.{alias}')
                : (t.httpRequestResultInfo || 'Result: context.httpResult')
              }
            </span>
          </div>
          <button
            onClick={() => setShowDevInfo(true)}
            className="text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap ml-2"
          >
            {t.developer_info || 'Developer Info'}
          </button>
        </div>
      </div>

      {/* Developer Info Dialog */}
      <Dialog open={showDevInfo} onOpenChange={setShowDevInfo}>
        <DialogContent className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 max-w-md">
          <DialogHeader>
            <DialogTitle>{t.developer_info || 'Developer Info'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-gray-400 mb-1">{t.result_stored_in || 'Result is stored in'}:</p>
              <code className="block p-2 bg-[#2A2A2A] rounded text-indigo-400">
                {isMulti ? 'context.httpResult.{alias}' : 'context.httpResult'}
              </code>
            </div>
            <div>
              <p className="text-gray-400 mb-1">{t.result_fields || 'Result Fields'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-green-400">success</span> - Request succeeded (boolean)</p>
                <p><span className="text-green-400">status</span> - HTTP status code (200, 404...)</p>
                <p><span className="text-green-400">statusText</span> - HTTP status text</p>
                <p><span className="text-green-400">data</span> - Response body (JSON parsed)</p>
                <p><span className="text-green-400">rawBody</span> - Response body (raw text)</p>
                {!isMulti && (
                  <p><span className="text-green-400">headers</span> - Response headers</p>
                )}
                <p><span className="text-green-400">duration</span> - Request duration (ms)</p>
                <p><span className="text-red-400">error</span> - Error message (if failed)</p>
              </div>
            </div>
            {isMulti && requests.filter(r => r.enabled).length > 0 && (
              <div>
                <p className="text-gray-400 mb-1">Access aliases:</p>
                <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                  {requests.filter(r => r.enabled).map(r => (
                    <p key={r.alias}>
                      <span className="text-indigo-400">context.httpResult.{r.alias || '?'}.data</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-gray-400 mb-1">{t.template_variables || 'Template Variables'}:</p>
              <div className="p-2 bg-[#2A2A2A] rounded font-mono text-xs space-y-1">
                <p><span className="text-indigo-400">{`{{context.xxx}}`}</span> - Context variables</p>
                <p><span className="text-indigo-400">{`{{message}}`}</span> - User message</p>
                <p><span className="text-indigo-400">{`{{aiResponse}}`}</span> - AI response</p>
                <p><span className="text-indigo-400">{`{{httpResult.data.xxx}}`}</span> - Previous HTTP result</p>
                <p><span className="text-indigo-400">{`{{jsonData.xxx}}`}</span> - JSON data fields</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
