import type { Edition } from '@/lib/edition'

export interface BrandAssets {
  widgetIcon: string
  poweredByWhite: string
  poweredByBlack: string
}

const CLOUD: BrandAssets = {
  widgetIcon: 'https://aitalkblog.blob.core.windows.net/blog/AiTalk.webp',
  poweredByWhite: 'https://aitalkblog.blob.core.windows.net/blog/AiTalk_w.webp',
  poweredByBlack: 'https://aitalkblog.blob.core.windows.net/blog/AiTalk_b.webp',
}

const SELF_HOSTED: BrandAssets = {
  widgetIcon: '/images/logo.png',
  poweredByWhite: '/aitalk01_w.png',
  poweredByBlack: '/aitalk01_b.png',
}

export function brandAssets(edition: Edition): BrandAssets {
  return edition === 'selfhosted' ? SELF_HOSTED : CLOUD
}
