import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { hashEmail } from '@/lib/anonymization'
import { authTokenService } from '@/lib/auth-tokens'
import { normalizeWidgetLanguage } from '@/lib/widget-settings'
import { sendVerificationEmailBackground } from '@/lib/background-email'
import { provisionTrialUser, provisionWebTrialUser } from '@/lib/auth/provision-user'
import { resolveActivePartner } from '@/lib/partner/resolve'
import { getRegionByCountryCode } from '@/lib/managed/regions'

const PARTNER_TRIAL_PLAN = 'starter' as const

export interface SignupInput {
  email: string
  password: string
  language?: string
  fingerprint?: string | null
  signupIp?: string | null
  baseUrl?: string
  source?: 'app'
  signupPlatform?: 'ios' | 'android' | null
  partnerCode?: string | null
}

export type SignupError =
  | 'INVALID_EMAIL'
  | 'PASSWORD_TOO_SHORT'
  | 'USER_EXISTS_VERIFIED'
  | 'USER_EXISTS_UNVERIFIED'
  | 'DEVICE_SIGNUP_LIMIT_EXCEEDED'
  | 'IP_SIGNUP_LIMIT_EXCEEDED'
  | 'INVALID_PARTNER_CODE'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SignupResult = { ok: true } | { ok: false; error: SignupError }

export async function signupCore(input: SignupInput): Promise<SignupResult> {
  const email = input.email
  const password = input.password

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, error: 'INVALID_EMAIL' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'PASSWORD_TOO_SHORT' }
  }

  if (input.partnerCode) {
    throw new Error('PARTNER_CODE_AT_SIGNUP_DISALLOWED')
  }

  const emailHash = hashEmail(email)
  const anonymized = await prisma.anonymizationHistory.findFirst({ where: { emailHash } })
  if (anonymized) {
    return { ok: false, error: 'USER_EXISTS_VERIFIED' }
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return { ok: false, error: existingUser.emailVerified ? 'USER_EXISTS_VERIFIED' : 'USER_EXISTS_UNVERIFIED' }
  }

  const fingerprint = input.fingerprint || undefined
  const signupIp = input.signupIp || null

  if (fingerprint) {
    const sameDeviceCount = await prisma.user.count({ where: { signupFingerprint: fingerprint } })
    if (sameDeviceCount >= 1) {
      return { ok: false, error: 'DEVICE_SIGNUP_LIMIT_EXCEEDED' }
    }
  }
  if (signupIp) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const sameIpCount = await prisma.user.count({
      where: { signupIp, createdAt: { gte: thirtyDaysAgo } },
    })
    if (sameIpCount >= 2) {
      return { ok: false, error: 'IP_SIGNUP_LIMIT_EXCEEDED' }
    }
  }

  let resolvedPartner: Awaited<ReturnType<typeof resolveActivePartner>> = null
  if (input.partnerCode) {
    resolvedPartner = await resolveActivePartner(input.partnerCode)
    if (!resolvedPartner) {
      return { ok: false, error: 'INVALID_PARTNER_CODE' }
    }
  }

  const hashedPassword = await bcrypt.hash(password, 12)

  let user
  try {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split('@')[0],
        password: hashedPassword,
        emailVerified: null,
        signupFingerprint: fingerprint || null,
        signupIp: signupIp || null,
      },
    })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const dup = await prisma.user.findUnique({ where: { email } })
      return { ok: false, error: dup?.emailVerified ? 'USER_EXISTS_VERIFIED' : 'USER_EXISTS_UNVERIFIED' }
    }
    throw e
  }

  const language = normalizeWidgetLanguage(input.language)

  const isServerTrial = input.source !== 'app'
  let provision: Awaited<ReturnType<typeof provisionTrialUser>>
  if (input.source === 'app') {
    provision = await provisionTrialUser({
      userId: user.id,
      language,
      signupSource: 'app',
      signupPlatform: input.signupPlatform ?? null,
      mode: 'best_effort',
    })
  } else if (resolvedPartner) {
    provision = await provisionTrialUser({
      userId: user.id,
      language,
      signupSource: 'web_partner',
      signupPlatform: 'web',
      planType: PARTNER_TRIAL_PLAN,
      serviceVariant: 'managed',
      trialGrantMode: 'server',
      partnerId: resolvedPartner.id,
      managedRegion: getRegionByCountryCode(resolvedPartner.country),
      mode: 'best_effort',
    })
  } else {
    provision = await provisionWebTrialUser({ userId: user.id, language, mode: 'best_effort' })
  }

  if (isServerTrial && provision.warnings.length > 0) {
    try {
      await prisma.user.delete({ where: { id: user.id } })
    } catch (delErr) {
      console.error('[signup] compensating user delete failed — account may block re-signup:', delErr)
    }
    throw new Error('TRIAL_PROVISION_FAILED')
  }

  if (resolvedPartner) {
    const cc = resolvedPartner.country.toUpperCase().slice(0, 100)
    await prisma.billingInfo.upsert({
      where: { id: user.id },
      update: { companyCountry: cc },
      create: { id: user.id, companyCountry: cc },
    }).catch((err) => console.error('[signup] partner country copy failed (non-fatal):', err))
  }

  try {
    const { token, hashedToken, expires } = authTokenService.generateVerificationToken(email)
    await prisma.verificationToken.create({
      data: { identifier: email, token: hashedToken, expires },
    })
    const baseUrl = input.baseUrl || process.env.NEXTAUTH_URL || 'http://localhost:3000'
    sendVerificationEmailBackground(email, token, baseUrl, language, input.source)
  } catch {
  }

  return { ok: true }
}
