import {
  ArrowDownRight,
  ArrowUpLeft,
  ChevronsLeftRight,
  ChevronsRightLeft,
  ChevronDown,
  CircleX,
  Expand,
  LogOut,
  Maximize2,
  MessageCirclePlus,
  MessageSquarePlus,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Shrink,
  X,
} from 'lucide-react'
import type { Language } from '@/lib/translations'

export const MAX_CUSTOM_ICON_SIZE_MB = 2

export const HEADER_KEYS = [
  { key: 'minimize', label: 'chat_settings_header_minimize', icon: Minimize2 },
  { key: 'maximize', label: 'chat_settings_header_maximize', icon: Maximize2 },
  { key: 'newConversation', label: 'chat_settings_header_new_conversation', icon: MessageSquarePlus },
  { key: 'close', label: 'chat_settings_header_close', icon: X },
] as const

export const HEADER_ICON_FILES = {
  close: {
    light: 'close-svgrepo-w.svg',
    dark: 'close-svgrepo-b.svg',
    logout_light: 'logout-w.svg',
    logout_dark: 'logout-b.svg',
    chevron_light: 'chevron-down-w.svg',
    chevron_dark: 'chevron-down-b.svg',
    circle_light: 'circle-x-w.svg',
    circle_dark: 'circle-x-b.svg',
  },
  newConversation: {
    light: 'chat-round-dots-w.svg',
    dark: 'chat-round-dots-b.svg',
    rotate_light: 'rotate-ccw-w.svg',
    rotate_dark: 'rotate-ccw-b.svg',
    circle_light: 'message-circle-plus-w.svg',
    circle_dark: 'message-circle-plus-b.svg',
    refresh_light: 'refresh-cw-w.svg',
    refresh_dark: 'refresh-cw-b.svg',
  },
  maximize: {
    light: 'maximize-1-svgrepo-w.svg',
    dark: 'maximize-1-svgrepo-b.svg',
    expand_light: 'expand-w.svg',
    expand_dark: 'expand-b.svg',
    arrow_light: 'arrow-up-left-w.svg',
    arrow_dark: 'arrow-up-left-b.svg',
    chevrons_light: 'chevrons-left-right-w.svg',
    chevrons_dark: 'chevrons-left-right-b.svg',
  },
  minimize: {
    light: 'minimize-1-svgrepo-w.svg',
    dark: 'minimize-1-svgrepo-b.svg',
    shrink_light: 'shrink-w.svg',
    shrink_dark: 'shrink-b.svg',
    arrow_light: 'arrow-down-right-w.svg',
    arrow_dark: 'arrow-down-right-b.svg',
    chevrons_light: 'chevrons-right-left-w.svg',
    chevrons_dark: 'chevrons-right-left-b.svg',
  },
}

export const HEADER_THEMES = ['light', 'dark'] as const

export const SEND_ICON_OPTIONS = [
  { value: 'send-b.svg', label: 'chat_settings_send_icon_dark', tone: 'dark' },
  { value: 'send-w.svg', label: 'chat_settings_send_icon_light', tone: 'light' },
  { value: 'send-horizontal-b.svg', label: 'chat_settings_send_icon_horizontal_dark', tone: 'dark' },
  { value: 'send-horizontal-w.svg', label: 'chat_settings_send_icon_horizontal_light', tone: 'light' },
  { value: 'navigation-b.svg', label: 'chat_settings_send_icon_navigation_dark', tone: 'dark' },
  { value: 'navigation-w.svg', label: 'chat_settings_send_icon_navigation_light', tone: 'light' },
  { value: 'corner-down-left-b.svg', label: 'chat_settings_send_icon_corner_down_left_dark', tone: 'dark' },
  { value: 'corner-down-left-w.svg', label: 'chat_settings_send_icon_corner_down_left_light', tone: 'light' },
] as const

export const POWERED_BY_OPTIONS = [
  { value: 'AITalk02_b.png', label: 'chat_settings_powered_by_aitalk_dark' },
  { value: 'AITalk02_w.png', label: 'chat_settings_powered_by_aitalk_light' },
  { value: 'none', label: 'chat_settings_powered_by_none' },
] as const

// 30 languages for Welcome Message
export const WELCOME_MESSAGE_LANGUAGES = [
  // Europe (17)
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska' },
  // Asia-Pacific (10)
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '中文 (简体)' },
  { code: 'zh-HK', name: 'Chinese (Hong Kong)', nativeName: '廣東話' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'tl', name: 'Tagalog', nativeName: 'Filipino' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  // Middle East (3)
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
] as const

export const LANGUAGES_WITH_DEFAULTS: Language[] = ['en', 'de', 'fr']

export const VALID_TABS = ['general', 'icons', 'experience', 'privacy', 'chat-button'] as const
