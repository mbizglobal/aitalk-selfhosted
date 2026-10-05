import NextAuth from 'next-auth'
import { isGoogleLoginEnabled } from '@/lib/auth/google-login'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { sendWelcomeEmailBackground } from '@/lib/background-email'
import { signupCore } from '@/lib/auth/signup-core'
import { provisionWebTrialUser } from '@/lib/auth/provision-user'
import { isSelfHosted } from '@/lib/edition'
import { cookies, headers } from 'next/headers'
import { normalizeWidgetLanguage } from '@/lib/widget-settings'
import { hashEmail } from '@/lib/anonymization'
import { maskEmail } from '@/lib/log-mask'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const authConfig = {
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(isGoogleLoginEnabled() ? [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID?.trim() as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() as string,
      authorization: {
        params: {
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'consent',
        }
      },
      httpOptions: {
        timeout: 10000,
      }
    })] : []),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        action: { label: 'Action', type: 'text' },
        language: { label: 'Language', type: 'text' }, // 'en', 'de', 'fr'
        fingerprint: { label: 'Fingerprint', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        try {
          if (isGoogleLoginEnabled() && credentials.email.trim().toLowerCase().endsWith('@gmail.com')) {
            throw new Error('Gmail users must use Google authentication')
          }

          if (credentials.action === 'signup') {
            const headersList = await headers()
            const signupIp = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
              || headersList.get('x-real-ip')
              || null

            let result
            try {
              result = await signupCore({
                email: credentials.email,
                password: credentials.password,
                language: credentials.language,
                fingerprint: credentials.fingerprint as string | undefined,
                signupIp,
              })
            } catch (e) {
              console.error('[signup] unexpected error:', e)
              throw new Error('SIGNUP_FAILED')
            }

            if (!result.ok) {
              throw new Error(result.error)
            }
            throw new Error('SIGNUP_SUCCESS')
          } else {
            const user = await prisma.user.findUnique({
              where: { email: credentials.email }
            })

            if (!user || !user.password) {
              throw new Error('Invalid credentials')
            }

            const isValid = await bcrypt.compare(credentials.password, user.password)

            if (!isValid) {
              throw new Error('Invalid credentials')
            }

            if (!user.emailVerified) {
              throw new Error('EMAIL_NOT_VERIFIED')
            }

            return {
              id: user.id,
              email: user.email!,
              name: user.name!,
            }
          }
        } catch (error) {
          throw error
        }
      },
    }),
  ],
  pages: {
    signIn: '/auth',
    signUp: '/auth',
    error: '/auth',
  },
  session: {
    strategy: 'jwt' as const,
  },
  callbacks: {
    async redirect({ url, baseUrl }: { url: string; baseUrl: string }) {
      const envBaseUrl = process.env.NEXTAUTH_URL
      const requestBaseUrl = baseUrl || envBaseUrl || ''
      const fallbackBaseUrl = envBaseUrl || requestBaseUrl

      const allowedOrigins = new Set<string>()
      if (requestBaseUrl) {
        allowedOrigins.add(new URL(requestBaseUrl).origin)
      }
      if (envBaseUrl) {
        allowedOrigins.add(new URL(envBaseUrl).origin)
      }

      if (url === requestBaseUrl || url === envBaseUrl || url === '/' || url.endsWith('/auth')) {
        return `${fallbackBaseUrl}/app`
      }

      if (url.startsWith('/')) {
        return `${requestBaseUrl}${url}`
      }

      try {
        const targetOrigin = new URL(url).origin
        if (allowedOrigins.has(targetOrigin)) {
          return url
        }
      } catch (error) {
        console.warn('Invalid redirect URL:', error)
      }

      return `${fallbackBaseUrl}/app`
    },
    async jwt({ token, user, account }: { token: any; user: any; account?: any }) {
      if (user) {
        token.id = user.id
        token.authAt = Date.now()
      }
      if (!token.id && token.sub) {
        token.id = token.sub
      }
      if (account) {
        token.account = account
      }

      const now = Date.now()
      if (token.id && (!token.refreshedAt || now - (token.refreshedAt as number) > 5 * 60 * 1000)) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { email: true, name: true }
          })
          if (dbUser) {
            token.email = dbUser.email
            token.name = dbUser.name
          }
          token.refreshedAt = now
        } catch {
        }
      }

      return token
    },
    async session({ session, token }: { session: any; token: any }) {
      if (token) {
        if (!session.user) {
          session.user = {}
        }
        session.user.id = token.id as string
        if (token.email) {
          session.user.email = token.email
        }
        if (token.name) {
          session.user.name = token.name
        }
      }

      if (session?.user?.email && session.user.id && token?.account?.provider === 'google') {
        try {
          const selfHosted = isSelfHosted()
          const [existingSettings, existingSubscription, hasAgent] = await Promise.all([
            prisma.settings.findUnique({ where: { id: session.user.id }, select: { id: true } }),
            selfHosted ? Promise.resolve(null) : prisma.subscription.findUnique({ where: { id: session.user.id }, select: { id: true } }),
            selfHosted ? prisma.agent.findFirst({ where: { userId: session.user.id }, select: { id: true } }) : Promise.resolve(null),
          ]);

          if (!existingSettings || (selfHosted ? !hasAgent : !existingSubscription)) {
            const userExists = await prisma.user.findUnique({
              where: { id: session.user.id },
              select: { id: true }
            })

            if (!userExists) {
              return session
            }

            let language: 'en' | 'de' | 'fr' | 'es' | 'ko' = 'en'

            try {
              const cookieStore = await cookies()
              const preferredLanguageCookie = cookieStore.get('preferred-language')
              if (preferredLanguageCookie?.value) {
                language = normalizeWidgetLanguage(preferredLanguageCookie.value)
              }
            } catch (error) {
            }

            const { warnings } = await provisionWebTrialUser({
              userId: session.user.id,
              language,
              mode: 'best_effort',
            })

            if (!warnings.includes('settings')) {
              try {
                const cookieStore = await cookies()
                const fingerprintCookie = cookieStore.get('signup-fingerprint')
                const fingerprint = fingerprintCookie?.value || null

                const headersList = await headers()
                const signupIp = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
                  || headersList.get('x-real-ip')
                  || null

                if (fingerprint || signupIp) {
                  await prisma.user.update({
                    where: { id: session.user.id },
                    data: {
                      signupFingerprint: fingerprint,
                      signupIp: signupIp,
                    }
                  })
                }
              } catch (error) {
                console.error('Failed to save fingerprint for Google user:', error)
              }

              const userName = session.user.name || session.user.email?.split('@')[0] || 'User';
              sendWelcomeEmailBackground(session.user.email, userName, language);
            }
          }

        } catch (error) {
        }
      }

      return session
    },
    async signIn({ user, account, profile, email, credentials, request }: { user: any; account: any; profile?: any; email?: any; credentials?: any; request?: any }) {
      if (user?.email) {
        try {
          const emailHash = hashEmail(user.email)
          const anonymizationHistory = await prisma.anonymizationHistory.findFirst({
            where: { emailHash }
          })

          if (anonymizationHistory) {
            console.log(`[SignIn Blocked] Email has been anonymized: ${maskEmail(user.email)}`)
            throw new Error('ANONYMIZED_USER')
          }
        } catch (error: any) {
          if (error?.message === 'ANONYMIZED_USER') {
            throw error
          }
          console.error('[SignIn] Failed to check AnonymizationHistory:', error)
        }
      }

      if (account?.provider === 'credentials' && user?.id) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { last_login_at: new Date() }
          })
        } catch (error) {
          console.error('Failed to update last_login_at:', error)
        }
      }

      if (account?.provider === 'google' && user?.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email }
          })

          if (!dbUser) {
            const cookieStore = await cookies()
            const fingerprintCookie = cookieStore.get('signup-fingerprint')
            const fingerprint = fingerprintCookie?.value || null

            const headersList = await headers()
            const signupIp = headersList.get('x-forwarded-for')?.split(',')[0]?.trim()
              || headersList.get('x-real-ip')
              || null

            if (fingerprint) {
              const sameDeviceCount = await prisma.user.count({
                where: { signupFingerprint: fingerprint }
              })
              if (sameDeviceCount >= 1) {
                throw new Error('DEVICE_SIGNUP_LIMIT_EXCEEDED')
              }
            }

            if (signupIp) {
              const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
              const sameIpCount = await prisma.user.count({
                where: {
                  signupIp: signupIp,
                  createdAt: { gte: thirtyDaysAgo }
                }
              })
              if (sameIpCount >= 2) {
                throw new Error('IP_SIGNUP_LIMIT_EXCEEDED')
              }
            }
          }

          if (dbUser) {
            const existingAccount = await prisma.account.findUnique({
              where: {
                provider_providerAccountId: {
                  provider: account.provider,
                  providerAccountId: account.providerAccountId
                }
              }
            })

            if (!existingAccount) {
              await prisma.account.create({
                data: {
                  userId: dbUser.id,
                  type: account.type || 'oauth',
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                  refresh_token: account.refresh_token || null,
                  access_token: account.access_token || null,
                  expires_at: account.expires_at || null,
                  token_type: account.token_type || null,
                  scope: account.scope || null,
                  id_token: account.id_token || null,
                  session_state: account.session_state || null
                }
              })
            }
          }
        } catch (error) {
          if (error instanceof Error &&
              (error.message === 'DEVICE_SIGNUP_LIMIT_EXCEEDED' || error.message === 'IP_SIGNUP_LIMIT_EXCEEDED')) {
            throw error
          }
        }
      }

      return true
    },
  },
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NEXTAUTH_URL?.startsWith('https://'),
      }
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NEXTAUTH_URL?.startsWith('https://'),
      }
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NEXTAUTH_URL?.startsWith('https://'),
      }
    }
  },
  events: {
    async signIn(message: any) {
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
}

const handler = NextAuth(authConfig)

export { handler as GET, handler as POST, authConfig as authOptions }
