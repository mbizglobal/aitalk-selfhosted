import type { WorkAppFactory } from '@/lib/work/package'
import { vatWorkApp } from '@/work-apps/vat'
import { assembledWorkApp } from '@/work-apps/assembled'

export const BUILTIN_WORK_APPS: readonly WorkAppFactory[] = [vatWorkApp, assembledWorkApp]
