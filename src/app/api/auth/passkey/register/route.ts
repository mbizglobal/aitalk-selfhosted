import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const rpName = 'AITalk'
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'
const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000'

const challengeStore = new Map<string, string>()

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const userEmail = session.user.email || ''

    const existingPasskeys = await prisma.passkey.findMany({
      where: { userId, kind: 'passkey' },
      select: { credentialId: true },
    })

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: userEmail,
      userDisplayName: session.user.name || userEmail,
      excludeCredentials: existingPasskeys.map((passkey) => ({
        id: passkey.credentialId,
        transports: ['internal', 'hybrid'],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      attestationType: 'none',
    })

    challengeStore.set(userId, options.challenge)

    setTimeout(() => challengeStore.delete(userId), 5 * 60 * 1000)

    return NextResponse.json(options)
  } catch (error) {
    console.error('[Passkey Register Options]', error)
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()
    const { response, name } = body as { response: RegistrationResponseJSON; name?: string }

    const expectedChallenge = challengeStore.get(userId)
    if (!expectedChallenge) {
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 })
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

    await prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: response.response.transports
          ? JSON.stringify(response.response.transports)
          : null,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: name || `Passkey ${new Date().toLocaleDateString()}`,
      },
    })

    challengeStore.delete(userId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Passkey Register Verify]', error)
    return NextResponse.json({ error: 'Failed to register passkey' }, { status: 500 })
  }
}
