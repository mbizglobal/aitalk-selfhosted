import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { encode } from 'next-auth/jwt'
import { cookies } from 'next/headers'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost'
const origin = process.env.NEXTAUTH_URL || 'http://localhost:3000'

const challengeStore = new Map<string, { challenge: string; email?: string }>()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')

    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = []

    if (email) {
      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          passkeys: {
            where: { kind: 'passkey' },
            select: {
              credentialId: true,
              transports: true,
            },
          },
        },
      })

      if (user?.passkeys?.length) {
        allowCredentials = user.passkeys.map((passkey) => ({
          id: passkey.credentialId,
          transports: passkey.transports
            ? (JSON.parse(passkey.transports) as AuthenticatorTransport[])
            : undefined,
        }))
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
      userVerification: 'preferred',
    })

    const tempId = crypto.randomUUID()

    challengeStore.set(tempId, { challenge: options.challenge, email: email || undefined })

    setTimeout(() => challengeStore.delete(tempId), 5 * 60 * 1000)

    return NextResponse.json({ ...options, tempId })
  } catch (error) {
    console.error('[Passkey Auth Options]', error)
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { response, tempId } = body as {
      response: AuthenticationResponseJSON
      tempId: string
    }

    const stored = challengeStore.get(tempId)
    if (!stored) {
      return NextResponse.json({ error: 'Challenge expired' }, { status: 400 })
    }

    const passkey = await prisma.passkey.findFirst({
      where: { credentialId: response.id, kind: 'passkey' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            emailVerified: true,
            isAnonymized: true,
          },
        },
      },
    })

    if (!passkey) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 400 })
    }

    if (passkey.user.isAnonymized) {
      return NextResponse.json({ error: 'Account has been anonymized' }, { status: 403 })
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

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    })

    await prisma.user.update({
      where: { id: passkey.userId },
      data: { last_login_at: new Date() },
    })

    challengeStore.delete(tempId)

    const token = await encode({
      token: {
        sub: passkey.user.id,
        id: passkey.user.id,
        email: passkey.user.email,
        name: passkey.user.name,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })

    const isSecure = origin.startsWith('https://')
    const cookieStore = await cookies()

    cookieStore.set('next-auth.session-token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 30 * 24 * 60 * 60,
    })

    if (isSecure) {
      cookieStore.set('__Secure-next-auth.session-token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: true,
        maxAge: 30 * 24 * 60 * 60,
      })
    }

    return NextResponse.json({
      success: true,
      user: {
        id: passkey.user.id,
        email: passkey.user.email,
        name: passkey.user.name,
      },
    })
  } catch (error) {
    console.error('[Passkey Auth Verify]', error)
    return NextResponse.json({ error: 'Failed to authenticate' }, { status: 500 })
  }
}
