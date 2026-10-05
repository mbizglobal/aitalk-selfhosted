import type { WorkAppFactory } from '@/lib/work/package'
import { vatWorkApp } from './vat'

export const BUILTIN_WORK_APPS: readonly WorkAppFactory[] = [vatWorkApp]
