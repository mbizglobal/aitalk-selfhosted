import { currentEdition } from '@/lib/edition'

export function hasCookieConsent(): boolean {
  if (currentEdition() === 'selfhosted') return true
  try {
    return localStorage.getItem('cookie-consent') === 'true'
  } catch {
    return false
  }
}
