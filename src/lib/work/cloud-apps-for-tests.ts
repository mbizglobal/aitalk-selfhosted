import { BUILTIN_WORK_APP_METAS } from '@/work-apps/builtin-meta'

const PUBLIC_APP_IDS = new Set(['vat', 'example', 'assembled'])
export const CLOUD_WORK_APPS = BUILTIN_WORK_APP_METAS.some((m) => !PUBLIC_APP_IDS.has(m.id))

export const cloudOnly: { skip: string | false } = {
  skip: CLOUD_WORK_APPS ? false : 'needs the Cloud work apps (Self-hosted ships the 1.0.1 VAT app only)',
}
