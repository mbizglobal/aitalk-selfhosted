import { NextResponse } from 'next/server'
import { isSelfHosted } from '@/lib/edition'
import { hasInstallOwner } from '@/lib/auth/selfhosted-setup'
import { describeCaughtError } from '@/lib/log-mask'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!isSelfHosted()) return NextResponse.json({ setupOpen: false })
  try {
    return NextResponse.json({ setupOpen: !(await hasInstallOwner()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[setup-status] failed:', describeCaughtError(e))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
