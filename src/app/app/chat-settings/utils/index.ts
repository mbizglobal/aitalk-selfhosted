import type { Language } from '@/lib/translations'
import {
  getDefaultWidgetSettings,
  normalizeRecommendedQuestions,
  WidgetSettings,
} from '@/lib/widget-settings'
import { HEADER_ICON_FILES, LANGUAGES_WITH_DEFAULTS } from '../constants'
import type { HeaderKey, HeaderTheme } from '../types'

// Clone settings (deep copy)
export const cloneSettings = (value: WidgetSettings): WidgetSettings =>
  JSON.parse(JSON.stringify(value)) as WidgetSettings

// Color validation
export const isValidHexColor = (value: string) =>
  /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value)

export const safeColorValue = (value: string, fallback = '#000000') =>
  isValidHexColor(value) ? value : fallback

// Get header icon filename based on key, theme, and variant
export const getHeaderIconFilename = (
  key: HeaderKey,
  theme: HeaderTheme,
  variant?: string
) => {
  if (key === 'newConversation' && variant === 'rotate') {
    return HEADER_ICON_FILES[key][
      `rotate_${theme}` as keyof typeof HEADER_ICON_FILES.newConversation
    ]
  }
  if (key === 'newConversation' && variant === 'circle') {
    return HEADER_ICON_FILES[key][
      `circle_${theme}` as keyof typeof HEADER_ICON_FILES.newConversation
    ]
  }
  if (key === 'newConversation' && variant === 'refresh') {
    return HEADER_ICON_FILES[key][
      `refresh_${theme}` as keyof typeof HEADER_ICON_FILES.newConversation
    ]
  }
  if (key === 'maximize' && variant === 'expand') {
    return HEADER_ICON_FILES[key][
      `expand_${theme}` as keyof typeof HEADER_ICON_FILES.maximize
    ]
  }
  if (key === 'maximize' && variant === 'arrow') {
    return HEADER_ICON_FILES[key][
      `arrow_${theme}` as keyof typeof HEADER_ICON_FILES.maximize
    ]
  }
  if (key === 'maximize' && variant === 'chevrons') {
    return HEADER_ICON_FILES[key][
      `chevrons_${theme}` as keyof typeof HEADER_ICON_FILES.maximize
    ]
  }
  if (key === 'minimize' && variant === 'shrink') {
    return HEADER_ICON_FILES[key][
      `shrink_${theme}` as keyof typeof HEADER_ICON_FILES.minimize
    ]
  }
  if (key === 'minimize' && variant === 'arrow') {
    return HEADER_ICON_FILES[key][
      `arrow_${theme}` as keyof typeof HEADER_ICON_FILES.minimize
    ]
  }
  if (key === 'minimize' && variant === 'chevrons') {
    return HEADER_ICON_FILES[key][
      `chevrons_${theme}` as keyof typeof HEADER_ICON_FILES.minimize
    ]
  }
  if (key === 'close' && variant === 'logout') {
    return HEADER_ICON_FILES[key][
      `logout_${theme}` as keyof typeof HEADER_ICON_FILES.close
    ]
  }
  if (key === 'close' && variant === 'chevron') {
    return HEADER_ICON_FILES[key][
      `chevron_${theme}` as keyof typeof HEADER_ICON_FILES.close
    ]
  }
  if (key === 'close' && variant === 'circle') {
    return HEADER_ICON_FILES[key][
      `circle_${theme}` as keyof typeof HEADER_ICON_FILES.close
    ]
  }
  return HEADER_ICON_FILES[key][theme]
}

// Get theme from icon filename
export const iconThemeFromFilename = (
  filename: string | undefined | null
): HeaderTheme => (filename && filename.includes('-w') ? 'light' : 'dark')

export const sendIconThemeFromFilename = (
  filename: string | undefined | null
): 'light' | 'dark' => (filename && filename.includes('-w') ? 'light' : 'dark')

// Apply language defaults to settings
// Note: With multi-language fields (Record<string, string>), this function
// now simply returns the settings as-is. Default values are handled elsewhere.
export const applyLanguageDefaults = (
  base: WidgetSettings,
  _language: Language
): WidgetSettings => {
  return base
}

// Gap input value handler (for ChatButton tab)
export const parseGapValue = (value: string, min = 0, max = 200): number => {
  const cleanValue = value.replace(/[^0-9]/g, '')
  const numValue = parseInt(cleanValue) || 0
  return Math.min(Math.max(numValue, min), max)
}

// Nested path update helper
export const updateNestedValue = (
  obj: any,
  path: string,
  value: any
): any => {
  const keys = path.split('.')
  const result = { ...obj }

  let current = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = { ...current[key] }
    current = current[key]
  }

  current[keys[keys.length - 1]] = value
  return result
}
