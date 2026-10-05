'use client'

import { ChangeEvent } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { PoweredByRule } from '@/lib/selfhosted-policy'
import { cn } from '@/lib/utils'
import {
  ArrowDownRight,
  ArrowUpLeft,
  Check,
  ChevronDown,
  ChevronsLeftRight,
  ChevronsRightLeft,
  CircleX,
  CornerDownLeft,
  Expand,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Maximize2,
  MessageCirclePlus,
  MessageSquarePlus,
  Minimize2,
  Navigation,
  RefreshCw,
  RotateCcw,
  Send,
  SendHorizontal,
  Shield,
  Shrink,
  X,
} from 'lucide-react'
import { ColorField } from '../ColorField'
import { getDefaultWidgetSettings } from '@/lib/widget-settings'
import {
  HEADER_KEYS,
  POWERED_BY_OPTIONS,
  MAX_CUSTOM_ICON_SIZE_MB,
} from '../../constants'
import { getHeaderIconFilename } from '../../utils'
import type { IconsTabProps, HeaderKey } from '../../types'

interface Props extends IconsTabProps {
  poweredByRule: PoweredByRule
  currentLanguage: string
  planLoading: boolean
  onReset: () => void
  // Crop image handlers
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isDragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  onRemoveCustomIcon: () => void
}

export function IconsTab({
  settings,
  onUpdate,
  t,
  userPlan,
  poweredByRule,
  currentLanguage,
  planLoading,
  onReset,
  fileInputRef,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onRemoveCustomIcon,
}: Props) {
  // Get icon variants for each header key
  const getIconVariants = (key: HeaderKey) => {
    const variants = []
    const IconComponent =
      HEADER_KEYS.find((k) => k.key === key)?.icon || Minimize2

    if (key === 'newConversation') {
      variants.push({ icon: RotateCcw, variant: 'rotate' })
      variants.push({ icon: IconComponent, variant: 'default' })
      variants.push({ icon: MessageCirclePlus, variant: 'circle' })
      variants.push({ icon: RefreshCw, variant: 'refresh' })
    } else {
      variants.push({ icon: IconComponent, variant: 'default' })
    }

    if (key === 'maximize') {
      variants.push({ icon: Expand, variant: 'expand' })
      variants.push({ icon: ArrowUpLeft, variant: 'arrow' })
      variants.push({ icon: ChevronsLeftRight, variant: 'chevrons' })
    }
    if (key === 'minimize') {
      variants.push({ icon: Shrink, variant: 'shrink' })
      variants.push({ icon: ArrowDownRight, variant: 'arrow' })
      variants.push({ icon: ChevronsRightLeft, variant: 'chevrons' })
    }
    if (key === 'close') {
      variants.push({ icon: LogOut, variant: 'logout' })
      variants.push({ icon: ChevronDown, variant: 'chevron' })
      variants.push({ icon: CircleX, variant: 'circle' })
    }

    return variants
  }

  return (
    <div className="space-y-6">
      {/* Custom Icon Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('chat_widget_icon_title')}</CardTitle>
          <CardDescription>{t('chat_widget_icon_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {planLoading ? (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 p-8">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                </div>
                <h3 className="mb-2 text-lg font-semibold">{t('loading')}</h3>
              </div>
            </div>
          ) : userPlan === 'free' ? (
            <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 p-8">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                    <Shield className="h-8 w-8 text-muted-foreground" />
                  </div>
                </div>
                <h3 className="mb-2 text-lg font-semibold">
                  {t('free_plan_restriction_title')}
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t('free_plan_custom_icon_message')}
                </p>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                'flex items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors',
                isDragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25'
              )}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  {settings.customIconData ? (
                    <img
                      src={settings.customIconData}
                      alt={t('widget_icon_alt')}
                      className="h-16 w-16 rounded-lg object-cover shadow-sm border"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <h3 className="mb-2 text-lg font-semibold">
                  {settings.customIconData
                    ? t('custom_icon_uploaded')
                    : t('upload_custom_icon_title')}
                </h3>
                <p className="mb-4 text-sm text-muted-foreground">
                  {t('upload_custom_icon_description')}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="gap-2"
                  >
                    <ImageIcon className="h-4 w-4" />
                    {t('choose_file_button')}
                  </Button>
                  {settings.customIconData && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onRemoveCustomIcon}
                      className="gap-2"
                    >
                      <X className="h-4 w-4" />
                      {t('remove_button')}
                    </Button>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('supported_formats')} •{' '}
                  {t('max_file_size').replace(
                    '{size}',
                    MAX_CUSTOM_ICON_SIZE_MB.toString()
                  )}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="hidden"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Header Icons Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('header_icons_title')}</CardTitle>
          <CardDescription>{t('header_icons_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {HEADER_KEYS.map(({ key, icon: IconComponent }) => {
            const labelKey =
              key === 'minimize'
                ? 'minimize_label'
                : key === 'maximize'
                  ? 'maximize_label'
                  : key === 'newConversation'
                    ? 'new_conversation_label'
                    : key === 'close'
                      ? 'close_label'
                      : key
            const colorLabelKey =
              key === 'minimize'
                ? 'minimize_color_label'
                : key === 'maximize'
                  ? 'maximize_color_label'
                  : key === 'newConversation'
                    ? 'new_conversation_color_label'
                    : key === 'close'
                      ? 'close_color_label'
                      : key

            const iconVariants = getIconVariants(key as HeaderKey)

            return (
              <div key={key} className="space-y-4">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <IconComponent className="h-4 w-4" /> {t(labelKey)}
                </Label>

                <div className="flex flex-wrap gap-3">
                  {iconVariants.map(({ icon: VariantIcon, variant }) => {
                    const lightFilename = getHeaderIconFilename(
                      key as HeaderKey,
                      'light',
                      variant === 'default' ? undefined : variant
                    )
                    const darkFilename = getHeaderIconFilename(
                      key as HeaderKey,
                      'dark',
                      variant === 'default' ? undefined : variant
                    )
                    const isActive =
                      settings.headerIcons[key as HeaderKey] ===
                        lightFilename ||
                      settings.headerIcons[key as HeaderKey] === darkFilename

                    return (
                      <button
                        key={variant}
                        onClick={() =>
                          onUpdate(`headerIcons.${key}`, lightFilename)
                        }
                        className={cn(
                          'relative h-12 w-24 rounded-md overflow-hidden transition-all',
                          isActive
                            ? 'border-2 border-primary ring-2 ring-primary/40'
                            : 'border border-border hover:border-primary/40'
                        )}
                      >
                        <div className="absolute inset-0 flex">
                          <div className="w-1/2 bg-gray-200"></div>
                          <div className="w-1/2 bg-slate-700"></div>
                        </div>
                        <div className="relative h-full flex">
                          <div className="w-1/2 flex items-center justify-center">
                            <VariantIcon
                              className="h-4 w-4"
                              style={{
                                color:
                                  settings.headerIconColors?.[
                                    key as HeaderKey
                                  ] || '#6b7280',
                              }}
                            />
                          </div>
                          <div className="w-1/2 flex items-center justify-center">
                            <VariantIcon
                              className="h-4 w-4"
                              style={{
                                color:
                                  settings.headerIconColors?.[
                                    key as HeaderKey
                                  ] || '#6b7280',
                              }}
                            />
                          </div>
                        </div>
                        {isActive && (
                          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                <ColorField
                  label={t(colorLabelKey)}
                  value={
                    settings.headerIconColors?.[key as HeaderKey] || '#6b7280'
                  }
                  onChange={(value) =>
                    onUpdate(`headerIconColors.${key}`, value)
                  }
                />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Send Icon & Branding Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('send_icon_branding_title')}</CardTitle>
          <CardDescription>{t('send_icon_branding_description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t('send_icon_label')}</Label>
            <div className="flex flex-wrap gap-3">
              {/* Send Icon Options */}
              {[
                { value: 'send-b.svg', icon: Send },
                { value: 'send-horizontal-b.svg', icon: SendHorizontal },
                { value: 'navigation-b.svg', icon: Navigation },
                { value: 'corner-down-left-b.svg', icon: CornerDownLeft },
              ].map(({ value, icon: IconComp }) => (
                <div
                  key={value}
                  className={cn(
                    'relative h-12 w-24 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 hover:ring-2 hover:ring-primary/40',
                    settings.sendIcon === value
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-transparent ring-0'
                  )}
                  onClick={() => onUpdate('sendIcon', value)}
                >
                  <div className="absolute inset-0 flex">
                    <div className="w-1/2 bg-gray-200"></div>
                    <div className="w-1/2 bg-slate-700"></div>
                  </div>
                  <div className="relative h-full flex">
                    <div className="w-1/2 flex items-center justify-center">
                      <IconComp
                        className="h-4 w-4"
                        style={{ color: settings.sendIconColor }}
                      />
                    </div>
                    <div className="w-1/2 flex items-center justify-center">
                      <IconComp
                        className="h-4 w-4"
                        style={{ color: settings.sendIconColor }}
                      />
                    </div>
                  </div>
                  {settings.sendIcon === value && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <ColorField
                  label={t('send_icon_color_label')}
                  value={settings.sendIconColor}
                  onChange={(value) => onUpdate('sendIconColor', value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onUpdate(
                    'sendIconColor',
                    getDefaultWidgetSettings(currentLanguage).sendIconColor
                  )
                }
                className="h-10 px-3"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                {t('reset_button')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t('powered_by_badge_label')}
            </Label>
            <div className="flex flex-wrap gap-2">
              {POWERED_BY_OPTIONS.map((option) => {
                const isActive = settings.poweredByImage === option.value
                const canHideBranding = option.value === 'none' ? poweredByRule !== 'show' : true
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    disabled={!canHideBranding}
                    onClick={() => canHideBranding && onUpdate('poweredByImage', option.value)}
                    title={!canHideBranding ? t('chat_settings_powered_by_none_upgrade') : undefined}
                  >
                    {t[option.label as keyof typeof t]}
                  </Button>
                )
              })}
            </div>
            {settings.poweredByImage !== 'none' && poweredByRule === 'show' && (
              <p className="text-xs text-muted-foreground">{t('chat_settings_powered_by_none_upgrade')}</p>
            )}
          </div>

          <ColorField
            label={t('powered_by_text_color_label')}
            value={settings.poweredByTextColor}
            onChange={(value) => onUpdate('poweredByTextColor', value)}
          />
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
