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
import { cn } from '@/lib/utils'
import {
  Bot,
  Brain,
  Cat,
  Check,
  CircleCheckBig,
  CircleHelp,
  CornerDownLeft,
  Edit3,
  Hand,
  Laugh,
  MessageCircle,
  MessageCircleMore,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquareMore,
  RefreshCw,
  Send,
  User,
} from 'lucide-react'
import { ColorField } from '../ColorField'
import { parseGapValue } from '../../utils'
import type { ChatButtonTabProps, EditableField } from '../../types'

interface Props extends ChatButtonTabProps {
  currentLanguage: string
  onReset: () => void
  onOpenMultiLangModal: (field: EditableField) => void
}

const CHAT_BUTTON_ICONS = [
  { value: 'message-circle', icon: MessageCircle },
  { value: 'message-square', icon: MessageSquare },
  { value: 'bot', icon: Bot },
  { value: 'send', icon: Send },
  { value: 'corner-down-left', icon: CornerDownLeft },
  { value: 'user', icon: User },
  { value: 'brain', icon: Brain },
  { value: 'cat', icon: Cat },
  { value: 'hand', icon: Hand },
  { value: 'laugh', icon: Laugh },
  { value: 'circle-check-big', icon: CircleCheckBig },
  { value: 'circle-help', icon: CircleHelp },
  { value: 'message-circle-more', icon: MessageCircleMore },
  { value: 'message-circle-question', icon: MessageCircleQuestion },
  { value: 'message-square-more', icon: MessageSquareMore },
]

export function ChatButtonTab({
  settings,
  onUpdate,
  t,
  currentLanguage,
  onReset,
  onOpenMultiLangModal,
}: Props) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('chat_button_title')}</CardTitle>
          <CardDescription>{t('chat_button_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ColorField
            label={t('chat_button_background_label')}
            value={settings.chatButton.backgroundColor}
            onChange={(value) => onUpdate('chatButton.backgroundColor', value)}
          />

          {/* Icon Type Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('chat_button_icon_type_label')}
            </Label>
            <div className="grid grid-cols-5 gap-2">
              {CHAT_BUTTON_ICONS.map((option) => {
                const isActive = settings.chatButton.iconType === option.value
                const IconComponent = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      onUpdate('chatButton.iconType', option.value)
                    }
                    className={cn(
                      'flex items-center justify-center rounded-lg border-2 p-3 transition-all relative',
                      isActive
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:border-primary/40'
                    )}
                  >
                    <IconComponent className="h-5 w-5" />
                    {isActive && (
                      <Check className="absolute top-0.5 right-0.5 h-3 w-3 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <ColorField
            label={t('chat_button_icon_color_label')}
            value={settings.chatButton.iconColor}
            onChange={(value) => onUpdate('chatButton.iconColor', value)}
          />

          <ColorField
            label={t('chat_button_shadow_color_label')}
            value={settings.chatButton.shadowColor}
            onChange={(value) => onUpdate('chatButton.shadowColor', value)}
          />

          {/* Shadow Direction */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('chat_button_shadow_direction_label')}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  value: 'bottom-right',
                  label: t('chat_button_shadow_direction_bottom_right'),
                },
                {
                  value: 'bottom',
                  label: t('chat_button_shadow_direction_bottom'),
                },
                {
                  value: 'right',
                  label: t('chat_button_shadow_direction_right'),
                },
                {
                  value: 'all',
                  label: t('chat_button_shadow_direction_all'),
                },
              ].map((option) => {
                const isActive =
                  settings.chatButton.shadowDirection === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      onUpdate('chatButton.shadowDirection', option.value)
                    }
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Shadow Intensity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {t('chat_button_shadow_intensity_label')}
              </Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(settings.chatButton.shadowIntensity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.chatButton.shadowIntensity}
              onChange={(e) =>
                onUpdate('chatButton.shadowIntensity', parseFloat(e.target.value))
              }
              className="w-full"
            />
          </div>

          {/* Preview Theme */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('chat_button_preview_theme_label')}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'light', label: t('chat_button_preview_theme_light') },
                { value: 'dark', label: t('chat_button_preview_theme_dark') },
              ].map((option) => {
                const isActive =
                  settings.chatButton.previewTheme === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      onUpdate('chatButton.previewTheme', option.value)
                    }
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Position */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('chat_button_position_label')}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'left', label: t('chat_button_position_left') },
                { value: 'right', label: t('chat_button_position_right') },
              ].map((option) => {
                const isActive = settings.chatButton.position === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      onUpdate('chatButton.position', option.value)
                    }
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Show Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('chat_button_show_on_label')}
            </Label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { value: 'always', label: t('chat_button_show_on_all_pages') },
                { value: 'topOnly', label: t('chat_button_show_on_top_only') },
                { value: 'hidden', label: t('chat_button_show_on_hidden') },
              ].map((option) => {
                const isActive = settings.chatButton.showMode === option.value
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() =>
                      onUpdate('chatButton.showMode', option.value)
                    }
                  >
                    {option.label}
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="horizontal-gap" className="text-sm font-medium">
                {t('chat_button_horizontal_gap_label')}
              </Label>
              <Input
                id="horizontal-gap"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={settings.chatButton.horizontalGap}
                onChange={(e) => {
                  const numValue = parseGapValue(e.target.value)
                  onUpdate('chatButton.horizontalGap', numValue)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vertical-gap" className="text-sm font-medium">
                {t('chat_button_vertical_gap_label')}
              </Label>
              <Input
                id="vertical-gap"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={settings.chatButton.verticalGap}
                onChange={(e) => {
                  const numValue = parseGapValue(e.target.value)
                  onUpdate('chatButton.verticalGap', numValue)
                }}
              />
            </div>
          </div>

          {/* Button Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {t('chat_button_size_label')}
              </Label>
              <span className="text-sm text-muted-foreground">
                {settings.chatButton.buttonSize}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="200"
              step="10"
              value={settings.chatButton.buttonSize}
              onChange={(e) =>
                onUpdate('chatButton.buttonSize', parseInt(e.target.value))
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground px-1">
              <span>50%</span>
              <span>80%</span>
              <span>100%</span>
              <span>120%</span>
              <span>150%</span>
              <span>180%</span>
              <span>200%</span>
            </div>
          </div>

          {/* Welcome Message - Multi-language */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Welcome Message</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenMultiLangModal('welcomeMessage')}
              >
                <Edit3 className="mr-2 h-3 w-3" />
                {t.chat_settings_button_edit}
              </Button>
            </div>
            <Textarea
              readOnly
              value={settings.welcomeMessage?.[currentLanguage] || ''}
              placeholder={t.chat_settings_enter_welcome_message_in_language.replace(
                '{language}',
                currentLanguage.toUpperCase()
              )}
              className="min-h-[60px] resize-none cursor-pointer bg-muted/50"
              onClick={() => onOpenMultiLangModal('welcomeMessage')}
            />
            {settings.welcomeMessage &&
              Object.keys(settings.welcomeMessage).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {Object.keys(settings.welcomeMessage).length}{' '}
                  {Object.keys(settings.welcomeMessage).length === 1
                    ? t.chat_settings_language_singular
                    : t.chat_settings_language_plural}
                  :{' '}
                  {Object.keys(settings.welcomeMessage)
                    .map((code) => code.toUpperCase())
                    .join(', ')}
                </p>
              )}
          </div>

          {/* Welcome Message Colors */}
          <div className="grid gap-4 md:grid-cols-2">
            <ColorField
              label="Welcome Message Background"
              value={settings.welcomeMessageBackgroundColor}
              onChange={(value) =>
                onUpdate('welcomeMessageBackgroundColor', value)
              }
            />
            <ColorField
              label="Welcome Message Text"
              value={settings.welcomeMessageTextColor}
              onChange={(value) => onUpdate('welcomeMessageTextColor', value)}
            />
          </div>

          {/* Welcome Message Close Delay */}
          <div className="space-y-2">
            <Label
              htmlFor="welcome-close-delay"
              className="text-sm font-medium"
            >
              {t('welcome_message_close_delay_label')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('welcome_message_close_delay_description')}
            </p>
            <Input
              id="welcome-close-delay"
              type="number"
              min="1"
              max="525600"
              value={settings.welcomeMessageCloseDelay || 1440}
              onChange={(e) =>
                onUpdate(
                  'welcomeMessageCloseDelay',
                  parseInt(e.target.value) || 1440
                )
              }
              placeholder={t('welcome_message_close_delay_placeholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('welcome_message_close_delay_help')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onReset}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('reset_to_defaults')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
