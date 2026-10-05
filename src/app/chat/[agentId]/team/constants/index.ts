
import { getTeamTranslation, type SupportedLang } from '@/lib/translations/team'

export function getGreetingMessage(lang?: SupportedLang): string {
  const hour = new Date().getHours()
  const t = (key: Parameters<typeof getTeamTranslation>[1]) => getTeamTranslation(lang, key)

  if (hour < 12) {
    return t('team_greeting_morning')
  } else if (hour < 18) {
    return t('team_greeting_afternoon')
  } else {
    return t('team_greeting_evening')
  }
}

export const COLORS = {
  background: '#1E1E1E',
  sidebarBackground: '#171717',
  border: '#2A2A2A',
  accent: '#E07B53',
  text: {
    primary: 'white',
    secondary: 'gray-200',
    muted: 'gray-400'
  }
} as const

export const LAYOUT = {
  sidebarWidth: 280,
  messageMaxWidth: '85%',
  inputMaxWidth: '48rem' // 3xl
} as const
