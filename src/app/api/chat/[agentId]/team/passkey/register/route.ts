import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { RegistrationResponseJSON } from '@simplewebauthn/server'
import { verifyActiveAgentMemberToken } from '@/lib/teamMemberCache'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const rpName = 'AITalk Team'
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'
const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000'

const challengeStore = new Map<number, string>()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const member = await prisma.agentMember.findUnique({
      where: { id: payload.memberId },
      select: {
        id: true,
        email: true,
        displayName: true,
        authMethod: true,
        status: true,
        passkeys: {
          select: { credentialId: true }
        }
      }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.authMethod !== 'password') {
      return NextResponse.json(
        { error: 'Passkey registration is only available for password members' },
        { status: 400 }
      )
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: member.email,
      userDisplayName: member.displayName || member.email,
      excludeCredentials: member.passkeys.map((passkey) => ({
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

    challengeStore.set(member.id, options.challenge)

    setTimeout(() => challengeStore.delete(member.id), 5 * 60 * 1000)

    return NextResponse.json(options)
  } catch (error) {
    console.error('[Team Passkey Register Options]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.substring(7)
    const payload = await verifyActiveAgentMemberToken(prisma, token, agentId)
    if (!payload || payload.agentId !== agentId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { response, name } = body as { response: RegistrationResponseJSON; name?: string }

    const member = await prisma.agentMember.findUnique({
      where: { id: payload.memberId },
      select: { id: true, authMethod: true, status: true }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.authMethod !== 'password') {
      return NextResponse.json(
        { error: 'Passkey registration is only available for password members' },
        { status: 400 }
      )
    }

    const expectedChallenge = challengeStore.get(member.id)
    if (!expectedChallenge) {
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 })
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

    const passkey = await prisma.agentMemberPasskey.create({
      data: {
        memberId: member.id,
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

    challengeStore.delete(member.id)

    return NextResponse.json({
      success: true,
      passkey: {
        id: passkey.id,
        name: passkey.name,
        deviceType: passkey.deviceType,
        createdAt: passkey.createdAt,
      }
    })
  } catch (error) {
    console.error('[Team Passkey Register Verify]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to register passkey' }, { status: 500 })
  }
}
