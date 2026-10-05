import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'
import { createAgentMemberToken } from '@/lib/agentMemberAuth'
import { describeCaughtError } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'
const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000'

const challengeStore = new Map<string, { challenge: string; agentId: string; email: string }>()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')?.toLowerCase().trim()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const member = await prisma.agentMember.findUnique({
      where: {
        agentAgentId_email: {
          agentAgentId: agentId,
          email
        }
      },
      include: {
        passkeys: {
          select: {
            credentialId: true,
            transports: true,
          }
        }
      }
    })

    if (!member || member.status !== 'active') {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    if (member.passkeys.length === 0) {
      return NextResponse.json({ error: 'No passkeys registered' }, { status: 400 })
    }

    const allowCredentials = member.passkeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports
        ? (JSON.parse(passkey.transports) as AuthenticatorTransport[])
        : undefined,
    }))

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    })

    const tempId = crypto.randomUUID()

    challengeStore.set(tempId, {
      challenge: options.challenge,
      agentId,
      email
    })

    setTimeout(() => challengeStore.delete(tempId), 5 * 60 * 1000)

    return NextResponse.json({ ...options, tempId })
  } catch (error) {
    console.error('[Team Passkey Auth Options]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params

    const body = await request.json()
    const { response, tempId } = body as {
      response: AuthenticationResponseJSON
      tempId: string
    }

    const stored = challengeStore.get(tempId)
    if (!stored || stored.agentId !== agentId) {
      return NextResponse.json({ error: 'Challenge expired or invalid' }, { status: 400 })
    }

    const passkey = await prisma.agentMemberPasskey.findUnique({
      where: { credentialId: response.id },
      include: {
        member: {
          select: {
            id: true,
            email: true,
            displayName: true,
            authMethod: true,
            status: true,
            agentAgentId: true,
          }
        }
      }
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 400 })
    }

    if (passkey.member.status !== 'active') {
      return NextResponse.json({ error: 'Account is suspended' }, { status: 403 })
    }

    if (passkey.member.agentAgentId !== agentId) {
      return NextResponse.json({ error: 'Passkey does not belong to this agent' }, { status: 403 })
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: Number(passkey.counter),
        transports: passkey.transports
          ? (JSON.parse(passkey.transports) as AuthenticatorTransport[])
          : undefined,
      },
      requireUserVerification: false,
    })

    if (!verification.verified) {
      return NextResponse.json({ error: 'Verification failed' }, { status: 400 })
    }

    await prisma.agentMemberPasskey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      }
    })

    await prisma.agentMember.update({
      where: { id: passkey.member.id },
      data: { lastSeenAt: new Date() }
    })

    challengeStore.delete(tempId)

    const { token, expiresAt } = createAgentMemberToken({
      agentId,
      memberId: passkey.member.id,
      email: passkey.member.email,
    })

    return NextResponse.json({
      success: true,
      token,
      expiresAt,
      member: {
        id: passkey.member.id,
        email: passkey.member.email,
        displayName: passkey.member.displayName,
        authMethod: passkey.member.authMethod,
      }
    })
  } catch (error) {
    console.error('[Team Passkey Auth Verify]', describeCaughtError(error))
    return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 })
  }
}
