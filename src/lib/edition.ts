export type Edition = 'cloud' | 'selfhosted'

export function getEdition(env: Record<string, string | undefined> = process.env): Edition {
  return env.AITALK_EDITION === 'selfhosted' ? 'selfhosted' : 'cloud'
}

export function isSelfHosted(env?: Record<string, string | undefined>): boolean {
  return getEdition(env) === 'selfhosted'
}

export function currentEdition(): Edition {
  if (typeof document !== 'undefined') return document.documentElement.dataset.edition === 'selfhosted' ? 'selfhosted' : 'cloud'
  return getEdition()
}
