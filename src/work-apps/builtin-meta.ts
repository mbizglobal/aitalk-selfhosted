import type { WorkAppMeta } from '@/lib/work/package-meta'
import { vatWorkAppMeta } from './vat/meta'

export const BUILTIN_WORK_APP_METAS: readonly WorkAppMeta[] = [vatWorkAppMeta]
