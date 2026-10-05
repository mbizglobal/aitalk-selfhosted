'use client'

import { Loader2, Save, Undo2, Wand2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { WidgetSettings } from '@/lib/widget-settings'
import { ChatPreview } from '../preview/ChatPreview'
import { ChatButtonPreview } from '../preview/ChatButtonPreview'
import type { TranslationFn } from '../types'

interface PreviewCardProps {
  settings: WidgetSettings
  t: TranslationFn
  activeTab: string
  loading: boolean
  isDirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

export function PreviewCard({
  settings,
  t,
  activeTab,
  loading,
  isDirty,
  saving,
  onSave,
  onDiscard,
}: PreviewCardProps) {
  return (
    <div className="sticky top-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {activeTab === 'chat-button'
              ? t('chat_button_preview_title')
              : t('chat_preview_title')}
          </CardTitle>
          <CardDescription>
            {activeTab === 'chat-button'
              ? t('chat_button_preview_description')
              : t('chat_preview_description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-[700px] text-muted-foreground">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                <p className="text-sm">{t('loading_preview')}</p>
              </div>
            </div>
          ) : activeTab === 'chat-button' ? (
            <ChatButtonPreview settings={settings} />
          ) : (
            <ChatPreview settings={settings} t={t} />
          )}
        </CardContent>
      </Card>

      {isDirty && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Wand2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-medium">{t('unsaved_changes')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('unsaved_changes_description')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onDiscard}
                  disabled={saving}
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {t('discard_button')}
                </Button>
                <Button type="button" onClick={onSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {t('save_button')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
