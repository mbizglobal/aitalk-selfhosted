import type { WorkAppMeta } from '@/lib/work/package-meta'
import { vatWorkAppMeta } from '@/work-apps/vat/meta'
import { assembledWorkAppMeta } from '@/work-apps/assembled/meta'

export const BUILTIN_WORK_APP_METAS: readonly WorkAppMeta[] = [vatWorkAppMeta, assembledWorkAppMeta]
