
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { loadCalendarMonth } from '@/lib/calendar/bookings-view'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const result = await loadCalendarMonth(prisma, session.user.id, {
      workflowId: sp.get('workflowId') || '',
      nodeId: sp.get('nodeId') || '',
      year: Number(sp.get('year')),
      month: Number(sp.get('month')),
      refresh: sp.get('refresh') === '1',
    })
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load events' },
      { status: 500 }
    )
  }
}
