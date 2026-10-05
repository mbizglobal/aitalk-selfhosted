import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import type { AccountType } from '@prisma/client'

const VALID: readonly AccountType[] = ['company', 'individual']

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => ({}))
  const accountType = body?.accountType
  if (!VALID.includes(accountType)) {
    return NextResponse.json({ error: 'INVALID_ACCOUNT_TYPE' }, { status: 400 })
  }

  await prisma.settings.upsert({
    where: { id: userId },
    update: { accountType },
    create: { id: userId, accountType },
  })
  return NextResponse.json({ ok: true })
}
