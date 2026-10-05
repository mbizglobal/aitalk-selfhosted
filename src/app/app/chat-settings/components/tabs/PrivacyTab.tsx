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
import type { PrivacyTabProps } from '../../types'

interface Props extends PrivacyTabProps {
  currentLanguage: string
  onReset: () => void
}

export function PrivacyTab({
  settings,
  onUpdate,
  t,
  onOpenMultiLangModal,
  currentLanguage,
  onReset,
}: Props) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('privacy_policy_title')}</CardTitle>
          <CardDescription>{t('privacy_policy_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            {/* Privacy Policy Text - Multi-language */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('display_text_label')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenMultiLangModal('privacyPolicyText')}
                >
                  <Edit3 className="mr-2 h-3 w-3" />
                  {t.chat_settings_button_edit}
                </Button>
              </div>
              <Input
                readOnly
                value={settings.privacyPolicy.text?.[currentLanguage] || ''}
                placeholder={t.chat_settings_enter_privacy_text_in_language.replace(
                  '{language}',
                  currentLanguage.toUpperCase()
                )}
                className="cursor-pointer bg-muted/50"
                onClick={() => onOpenMultiLangModal('privacyPolicyText')}
              />
              {settings.privacyPolicy.text &&
                Object.keys(settings.privacyPolicy.text).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {Object.keys(settings.privacyPolicy.text).length}{' '}
                    {Object.keys(settings.privacyPolicy.text).length === 1
                      ? t.chat_settings_language_singular
                      : t.chat_settings_language_plural}
                    :{' '}
                    {Object.keys(settings.privacyPolicy.text)
                      .map((code) => code.toUpperCase())
                      .join(', ')}
                  </p>
                )}
            </div>

            {/* Privacy Policy Link Text - Multi-language */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('link_text_label')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenMultiLangModal('privacyPolicyLinkText')}
                >
                  <Edit3 className="mr-2 h-3 w-3" />
                  {t.chat_settings_button_edit}
                </Button>
              </div>
              <Input
                readOnly
                value={settings.privacyPolicy.linkText?.[currentLanguage] || ''}
                placeholder={t.chat_settings_enter_privacy_link_in_language.replace(
                  '{language}',
                  currentLanguage.toUpperCase()
                )}
                className="cursor-pointer bg-muted/50"
                onClick={() => onOpenMultiLangModal('privacyPolicyLinkText')}
              />
              {settings.privacyPolicy.linkText &&
                Object.keys(settings.privacyPolicy.linkText).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {Object.keys(settings.privacyPolicy.linkText).length}{' '}
                    {Object.keys(settings.privacyPolicy.linkText).length === 1
                      ? t.chat_settings_language_singular
                      : t.chat_settings_language_plural}
                    :{' '}
                    {Object.keys(settings.privacyPolicy.linkText)
                      .map((code) => code.toUpperCase())
                      .join(', ')}
                  </p>
                )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="privacy-url">{t('url_label')}</Label>
              <Input
                id="privacy-url"
                value={settings.privacyPolicy.url}
                onChange={(event) =>
                  onUpdate('privacyPolicy.url', event.target.value)
                }
                placeholder={t('url_placeholder')}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <ColorField
                label={t('background_label')}
                value={settings.privacyPolicy.backgroundColor}
                onChange={(value) =>
                  onUpdate('privacyPolicy.backgroundColor', value)
                }
              />
              <ColorField
                label={t('text_label')}
                value={settings.privacyPolicy.textColor}
                onChange={(value) =>
                  onUpdate('privacyPolicy.textColor', value)
                }
              />
              <ColorField
                label={t('link_label')}
                value={settings.privacyPolicy.linkColor}
                onChange={(value) =>
                  onUpdate('privacyPolicy.linkColor', value)
                }
              />
            </div>
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
