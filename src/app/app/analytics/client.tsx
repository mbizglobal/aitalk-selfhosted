'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/hooks/useLanguage'
import { getTranslations } from '@/lib/translations/app'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { BarChart3, ExternalLink, Trash2, TestTube, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface AnalyticsConfig {
  measurementId: string
  isEnabled: boolean
  hasApiSecret: boolean
}

interface AnalyticsClientProps {
  websiteUrl: string
}

export default function AnalyticsClient({ websiteUrl }: AnalyticsClientProps) {
  const { currentLanguage } = useLanguage()
  const t = getTranslations(currentLanguage)

  const [config, setConfig] = useState<AnalyticsConfig & { apiSecret: string }>({
    measurementId: '',
    apiSecret: '',
    isEnabled: true,
    hasApiSecret: false,
  })
  const [originalConfig, setOriginalConfig] = useState<AnalyticsConfig>({
    measurementId: '',
    isEnabled: true,
    hasApiSecret: false,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const hasChanges = config.measurementId !== originalConfig.measurementId ||
    config.isEnabled !== originalConfig.isEnabled ||
    config.apiSecret.length > 0

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/analytics')
      const data = await response.json()
      if (data.success && data.config) {
        const loadedConfig = {
          measurementId: data.config.measurementId || '',
          isEnabled: data.config.isEnabled ?? true,
          hasApiSecret: data.config.hasApiSecret || false,
        }
        setConfig({
          ...loadedConfig,
          apiSecret: '',
        })
        setOriginalConfig(loadedConfig)
      }
    } catch (error) {
      console.error('Failed to load analytics config:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config.measurementId) {
      toast.error(t.analytics_measurement_id_required)
      return
    }
    if (!config.hasApiSecret && !config.apiSecret) {
      toast.error(t.analytics_api_secret_required)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          measurementId: config.measurementId,
          apiSecret: config.apiSecret || undefined,
          isEnabled: config.isEnabled,
        })
      })
      const data = await response.json()
      if (data.success) {
        toast.success(t.analytics_saved)
        const updatedConfig = {
          measurementId: config.measurementId,
          isEnabled: config.isEnabled,
          hasApiSecret: true,
        }
        setConfig({ ...updatedConfig, apiSecret: '' })
        setOriginalConfig(updatedConfig)
      } else {
        toast.error(data.error || t.analytics_save_failed)
      }
    } catch (error) {
      toast.error(t.analytics_save_failed)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      const response = await fetch('/api/analytics/test', { method: 'POST' })
      const data = await response.json()
      if (data.success) {
        toast.success(t.analytics_test_success)
      } else {
        toast.error(data.error || t.analytics_test_failed)
      }
    } catch (error) {
      toast.error(t.analytics_test_failed)
    } finally {
      setIsTesting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(t.analytics_delete_confirm)) return

    setIsDeleting(true)
    try {
      const response = await fetch('/api/analytics', { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        toast.success(t.analytics_deleted)
        setConfig({
          measurementId: '',
          apiSecret: '',
          isEnabled: true,
          hasApiSecret: false,
        })
      } else {
        toast.error(data.error || t.analytics_delete_failed)
      }
    } catch (error) {
      toast.error(t.analytics_delete_failed)
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          {t.analytics_title}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t.analytics_description}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t.analytics_connection_status}
            {config.hasApiSecret ? (
              <Badge variant="default" className="bg-green-500">
                <CheckCircle className="h-3 w-3 mr-1" />
                {t.analytics_connected}
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                {t.analytics_not_configured}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.analytics_configuration}</CardTitle>
          <CardDescription>{t.analytics_configuration_desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Measurement ID */}
          <div className="space-y-2">
            <Label htmlFor="measurementId">{t.analytics_measurement_id}</Label>
            <Input
              id="measurementId"
              placeholder="G-XXXXXXXXXX"
              value={config.measurementId}
              onChange={(e) => setConfig(prev => ({ ...prev, measurementId: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {t.analytics_measurement_id_help}
            </p>
          </div>

          {/* API Secret */}
          <div className="space-y-2">
            <Label htmlFor="apiSecret">
              {t.analytics_api_secret}
              {config.hasApiSecret && (
                <span className="ml-2 text-xs text-green-500">({t.analytics_configured})</span>
              )}
            </Label>
            <Input
              id="apiSecret"
              type="password"
              placeholder={config.hasApiSecret ? '••••••••' : t.analytics_api_secret_placeholder}
              value={config.apiSecret}
              onChange={(e) => setConfig(prev => ({ ...prev, apiSecret: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {t.analytics_api_secret_help}
            </p>
          </div>

          {/* Enable/Disable */}
          <div className="flex items-center justify-between">
            <div>
              <Label>{t.analytics_enable_tracking}</Label>
              <p className="text-xs text-muted-foreground">
                {t.analytics_enable_tracking_desc}
              </p>
            </div>
            <Switch
              checked={config.isEnabled}
              onCheckedChange={(checked) => setConfig(prev => ({ ...prev, isEnabled: checked }))}
              className="data-[state=checked]:bg-green-500"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-4">
            <Button onClick={handleSave} disabled={isSaving || (config.hasApiSecret && !hasChanges)}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isSaving ? t.saving : t.save_button}
            </Button>
            {config.hasApiSecret && (
              <>
                <Button variant="outline" onClick={handleTest} disabled={isTesting}>
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4 mr-2" />
                  )}
                  {isTesting ? t.analytics_testing : t.analytics_test_connection}
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 mr-2" />
                  )}
                  {isDeleting ? t.deleting : t.delete_button}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.analytics_help_title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium">{t.analytics_help_create_property}</h4>
            <ol className="list-decimal list-inside text-sm text-muted-foreground mt-2 space-y-1">
              <li>{t.analytics_help_create_step1}</li>
              <li>{t.analytics_help_create_step2}: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">{websiteUrl}</code></li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium">{t.analytics_help_get_credentials}</h4>
            <ol className="list-decimal list-inside text-sm text-muted-foreground mt-2 space-y-1">
              <li>{t.analytics_help_step1}</li>
              <li>{t.analytics_help_step2}</li>
              <li>{t.analytics_help_step3}</li>
              <li>{t.analytics_help_step4}</li>
            </ol>
          </div>
          <div>
            <h4 className="font-medium">{t.analytics_help_tracked_events}</h4>
            <ul className="list-disc list-inside text-sm text-muted-foreground mt-2 space-y-1">
              <li>{t.analytics_help_event1}</li>
              <li>{t.analytics_help_event2}</li>
              <li>{t.analytics_help_event3}</li>
              <li>{t.analytics_help_event4}</li>
            </ul>
          </div>
          <Button variant="link" className="p-0 h-auto" asChild>
            <a
              href="https://developers.google.com/analytics/devguides/collection/protocol/ga4"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.analytics_help_docs_link}
              <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
