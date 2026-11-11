import type { PrismaClient } from '@prisma/client'
import type { Senders } from './sends'
import { createWorkSenders } from './work-senders'

export function workSenders(db: PrismaClient): Senders {
  return createWorkSenders(db)
}
