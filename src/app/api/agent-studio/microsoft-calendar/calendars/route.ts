
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { getMicrosoftCalendarAccountAccessToken } from '@/lib/microsoft/access-token'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const accountIdParam = request.nextUrl.searchParams.get('accountId')
    const connectionIdParam = request.nextUrl.searchParams.get('connectionId')

    let accountId: string | null = accountIdParam
    if (!accountId && connectionIdParam) {
      const firstAccount = await prisma.workflowCalendarAccount.findFirst({
        where: {
          connectionId: connectionIdParam,
          userId: session.user.id,
          status: 'active',
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      })
      accountId = firstAccount?.id || null
    }

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'accountId or connectionId required' },
        { status: 400 }
      )
    }

    const account = await prisma.workflowCalendarAccount.findFirst({
      where: {
        id: accountId,
        userId: session.user.id,
        status: 'active',
      },
      select: { id: true },
    })
    if (!account) {
      return NextResponse.json({ success: false, error: 'Account not found' }, { status: 404 })
    }

    const accessToken = await getMicrosoftCalendarAccountAccessToken(prisma, accountId)

    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar,canEdit',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || `calendars failed (${response.status})` },
        { status: response.status }
      )
    }

    const calendars = (data.value || [])
      .filter((c: any) => c.canEdit !== false)
      .map((c: any) => ({
        id: c.id,
        name: c.name,
        primary: !!c.isDefaultCalendar,
      }))

    return NextResponse.json({ success: true, calendars })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to list calendars' },
      { status: 500 }
    )
  }
}
