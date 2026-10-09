import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]/route'
import { isSelfHosted } from '@/lib/edition'
import { isInstallAdmin } from '@/lib/auth/selfhosted-setup'
import { getLicenseState } from '@/lib/license'

export async function GET() {
  if (!isSelfHosted()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getServerSession(authOptions as any) as any
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isInstallAdmin(session.user))) return NextResponse.json({ success: true, canView: false })
  const s = getLicenseState()
  const base = { success: true, canView: true, status: s.status }
  if (s.status === 'none') return NextResponse.json(base)
  if (s.status === 'invalid') return NextResponse.json({ ...base, reason: s.reason })
  const { licensee, licenseId, expiresAt, clientCompanies } = s.payload
  return NextResponse.json({
    ...base,
    licensee,
    licenseId,
    expiresAt,
    clientCompanies: clientCompanies ?? null,
    features: s.status === 'expired' ? [] : s.features,
    graceEndsAt: s.status === 'expired' ? null : s.graceEndsAt.toISOString().slice(0, 10),
  })
}
