'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Edit3, RefreshCw } from 'lucide-react'
import { ColorField } from '../ColorField'
import type { GeneralTabProps } from '../../types'

interface Props extends GeneralTabProps {
  currentLanguage: string
  loading: boolean
  onReset: () => void
}

export function GeneralTab({
  settings,
  onUpdate,
  t,
  agentTitle,
  onOpenMultiLangModal,
  currentLanguage,
  loading,
  onReset,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('general_appearance_title')}</CardTitle>
        <CardDescription>{t('general_appearance_description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="header-title">{t('header_title_label')}</Label>
          <Input
            id="header-title"
            value={settings.headerTitle}
            onChange={(event) => onUpdate('headerTitle', event.target.value)}
            placeholder={loading ? t('loading') : t('header_title_placeholder')}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('header_background_label')}
            value={settings.headerBackgroundColor}
            onChange={(value) => onUpdate('headerBackgroundColor', value)}
          />
          <ColorField
            label={t('header_text_label')}
            value={settings.headerTextColor}
            onChange={(value) => onUpdate('headerTextColor', value)}
          />
        </div>

        {/* Initial Message - Multi-language */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('initial_message_label')}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenMultiLangModal('initialMessage')}
            >
              <Edit3 className="mr-2 h-3 w-3" />
              {t.chat_settings_button_edit}
            </Button>
          </div>
          <Textarea
            readOnly
            value={settings.initialMessage?.[currentLanguage] || ''}
            placeholder={t.chat_settings_enter_in_language.replace(
              '{language}',
              currentLanguage.toUpperCase()
            )}
            className="min-h-[80px] resize-none cursor-pointer bg-muted/50"
            onClick={() => onOpenMultiLangModal('initialMessage')}
          />
          {settings.initialMessage &&
            Object.keys(settings.initialMessage).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {Object.keys(settings.initialMessage).length}{' '}
                {Object.keys(settings.initialMessage).length === 1
                  ? t.chat_settings_language_singular
                  : t.chat_settings_language_plural}
                :{' '}
                {Object.keys(settings.initialMessage)
                  .map((code) => code.toUpperCase())
                  .join(', ')}
              </p>
            )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('ai_message_background_label')}
            value={settings.initialMessageBackgroundColor}
            onChange={(value) => onUpdate('initialMessageBackgroundColor', value)}
          />
          <ColorField
            label={t('ai_message_text_label')}
            value={settings.initialMessageTextColor}
            onChange={(value) => onUpdate('initialMessageTextColor', value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('user_message_background_label')}
            value={settings.userMessageBackgroundColor}
            onChange={(value) => onUpdate('userMessageBackgroundColor', value)}
          />
          <ColorField
            label={t('user_message_text_label')}
            value={settings.userMessageTextColor}
            onChange={(value) => onUpdate('userMessageTextColor', value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('ai_message_time_label')}
            value={settings.aiMessageTimeColor}
            onChange={(value) => onUpdate('aiMessageTimeColor', value)}
          />
          <ColorField
            label={t('user_message_time_label')}
            value={settings.userMessageTimeColor}
            onChange={(value) => onUpdate('userMessageTimeColor', value)}
          />
        </div>

        {/* Input Placeholder - Multi-language */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('input_placeholder_label')}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenMultiLangModal('inputPlaceholder')}
            >
              <Edit3 className="mr-2 h-3 w-3" />
              {t.chat_settings_button_edit}
            </Button>
          </div>
          <Input
            readOnly
            value={settings.inputPlaceholder?.[currentLanguage] || ''}
            placeholder={t.chat_settings_enter_input_placeholder_in_language.replace(
              '{language}',
              currentLanguage.toUpperCase()
            )}
            className="cursor-pointer bg-muted/50"
            onClick={() => onOpenMultiLangModal('inputPlaceholder')}
          />
          {settings.inputPlaceholder &&
            Object.keys(settings.inputPlaceholder).length > 0 && (
              <p className="text-xs text-muted-foreground">
                {Object.keys(settings.inputPlaceholder).length}{' '}
                {Object.keys(settings.inputPlaceholder).length === 1
                  ? t.chat_settings_language_singular
                  : t.chat_settings_language_plural}
                :{' '}
                {Object.keys(settings.inputPlaceholder)
                  .map((code) => code.toUpperCase())
                  .join(', ')}
              </p>
            )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('input_background_label')}
            value={settings.inputBackgroundColor}
            onChange={(value) => onUpdate('inputBackgroundColor', value)}
          />
          <ColorField
            label={t('input_text_label')}
            value={settings.inputTextColor}
            onChange={(value) => onUpdate('inputTextColor', value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('input_border_label')}
            value={settings.inputBorderColor}
            onChange={(value) => onUpdate('inputBorderColor', value)}
          />
          <ColorField
            label={t('input_focus_border_label')}
            value={settings.inputFocusBorderColor}
            onChange={(value) => onUpdate('inputFocusBorderColor', value)}
          />
        </div>

        <ColorField
          label={t('chat_window_background_label')}
          value={settings.chatWindowBackgroundColor}
          onChange={(value) => onUpdate('chatWindowBackgroundColor', value)}
        />

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onReset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('reset_to_defaults')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
