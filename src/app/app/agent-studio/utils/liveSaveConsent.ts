
const MUTE_KEY = 'aitalk_live_save_confirm_muted_until'

export const LIVE_SAVE_MUTE_DAYS = 5

export function isLiveSaveConfirmMuted(): boolean {
  try {
    const raw = localStorage.getItem(MUTE_KEY)
    if (!raw) return false
    const until = Number(raw)
    if (!Number.isFinite(until)) return false
    if (Date.now() >= until) {
      localStorage.removeItem(MUTE_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

export function muteLiveSaveConfirm(): void {
  try {
    const until = Date.now() + LIVE_SAVE_MUTE_DAYS * 24 * 60 * 60 * 1000
    localStorage.setItem(MUTE_KEY, String(until))
  } catch {
  }
}
