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
import { Edit3, RefreshCw } from 'lucide-react'
import { ColorField } from '../ColorField'
import type { ExperienceTabProps, EditableField } from '../../types'

interface Props extends ExperienceTabProps {
  currentLanguage: string
  onReset: () => void
  getFieldValue: (field: EditableField) => Record<string, string> | null
}

export function ExperienceTab({
  settings,
  onUpdate,
  t,
  onOpenMultiLangModal,
  currentLanguage,
  onReset,
  getFieldValue,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Waiting Response Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('waiting_response_title')}</CardTitle>
          <CardDescription>{t('waiting_response_description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('loading_icon_label')}
            value={settings.loadingIconColor}
            onChange={(value) => onUpdate('loadingIconColor', value)}
          />
          <ColorField
            label={t('loading_text_label')}
            value={settings.loadingTextColor}
            onChange={(value) => onUpdate('loadingTextColor', value)}
          />
        </CardContent>
      </Card>

      {/* Scrollbar Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('scrollbar_title')}</CardTitle>
          <CardDescription>{t('scrollbar_description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <ColorField
            label={t('thumb_color_label')}
            value={settings.scrollbarThumbColor}
            onChange={(value) => onUpdate('scrollbarThumbColor', value)}
          />
          <ColorField
            label={t('track_color_label')}
            value={settings.scrollbarTrackColor}
            onChange={(value) => onUpdate('scrollbarTrackColor', value)}
          />
        </CardContent>
      </Card>

      {/* Recommended Questions Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('recommended_questions_title')}</CardTitle>
          <CardDescription>
            {t('recommended_questions_description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <ColorField
              label={t('background_label')}
              value={settings.recommendedQuestionsBackgroundColor}
              onChange={(value) =>
                onUpdate('recommendedQuestionsBackgroundColor', value)
              }
            />
            <ColorField
              label={t('text_label')}
              value={settings.recommendedQuestionsTextColor}
              onChange={(value) =>
                onUpdate('recommendedQuestionsTextColor', value)
              }
            />
          </div>

          {/* Recommended Questions - Multi-language */}
          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                'recommendedQuestion1',
                'recommendedQuestion2',
                'recommendedQuestion3',
                'recommendedQuestion4',
              ] as EditableField[]
            ).map((field, index) => {
              const fieldValue = getFieldValue(field)
              return (
                <div key={field} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      {t('question_label').replace('{0}', (index + 1).toString())}
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpenMultiLangModal(field)}
                    >
                      <Edit3 className="mr-2 h-3 w-3" />
                      {t.chat_settings_button_edit}
                    </Button>
                  </div>
                  <Input
                    readOnly
                    value={fieldValue?.[currentLanguage] || ''}
                    placeholder={t.chat_settings_enter_question_in_language
                      .replace('{number}', String(index + 1))
                      .replace('{language}', currentLanguage.toUpperCase())}
                    className="cursor-pointer bg-muted/50"
                    onClick={() => onOpenMultiLangModal(field)}
                  />
                  {fieldValue && Object.keys(fieldValue).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {Object.keys(fieldValue).length}{' '}
                      {Object.keys(fieldValue).length === 1
                        ? t.chat_settings_language_singular
                        : t.chat_settings_language_plural}
                      :{' '}
                      {Object.keys(fieldValue)
                        .map((code) => code.toUpperCase())
                        .join(', ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onReset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('reset_to_defaults')}
        </Button>
      </div>
    </div>
  )
}
