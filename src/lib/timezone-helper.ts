
export function getTimezoneByLanguage(language: 'en' | 'de' | 'fr' | 'es' | 'ko'): string {
  switch (language) {
    case 'ko':
      return 'Asia/Seoul'
    case 'en':
      return 'America/New_York'
    case 'de':
    case 'fr':
      return 'Europe/Zurich'
    case 'es':
      return 'Europe/Madrid'
    default:
      return 'Europe/Zurich'
  }
}

export function getTimeFormatByLanguage(language: 'en' | 'de' | 'fr' | 'es' | 'ko'): string {
  switch (language) {
    case 'ko':
      return 'YYYY-MM-DD HH:mm'
    case 'en':
      return 'MM/DD/YYYY hh:mm AM'
    case 'de':
    case 'fr':
      return 'DD.MM.YYYY HH:mm'
    case 'es':
      return 'DD/MM/YYYY HH:mm'
    default:
      return 'DD.MM.YYYY HH:mm'
  }
}
