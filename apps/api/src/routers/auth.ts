import { router, publicProcedure, protectedProcedure } from '../trpc.js'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { prisma } from 'database'
import { lucia } from '../auth/lucia.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { google, GOOGLE_SCOPES } from '../auth/google.js'
import { encrypt, decrypt } from '../auth/encryption.js'
import { generateCodeVerifier, generateState } from 'arctic'

export const authRouter = router({
  /**
   * Get current authentication status
   */
  status: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return { authenticated: false, user: null }
    }

    return {
      authenticated: true,
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
      },
    }
  }),

  /**
   * Sign up with email and password
   */
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: input.email },
      })

      if (existingUser) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'User with this email already exists',
        })
      }

      // Hash password
      const hashedPassword = await hashPassword(input.password)

      // Create user
      const user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          hashedPassword,
        },
      })

      // Create session
      const session = await lucia.createSession(user.id, {})
      const sessionCookie = lucia.createSessionCookie(session.id)
      ctx.res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      }
    }),

  /**
   * Login with email and password
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email: input.email },
      })

      if (!user || !user.hashedPassword) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        })
      }

      // Verify password
      const validPassword = await verifyPassword(user.hashedPassword, input.password)

      if (!validPassword) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        })
      }

      // Create session
      const session = await lucia.createSession(user.id, {})
      const sessionCookie = lucia.createSessionCookie(session.id)
      ctx.res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      }
    }),

  /**
   * Logout - invalidate session
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    await lucia.invalidateSession(ctx.session.id)
    const sessionCookie = lucia.createBlankSessionCookie()
    ctx.res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

    return { success: true }
  }),

  /**
   * Initiate Google OAuth flow
   * Returns authorization URL and stores state/code verifier in cookies
   */
  googleOAuth: publicProcedure.mutation(async ({ ctx }) => {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()

    const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES)

    // Store state and code verifier in cookies for verification
    ctx.res.setCookie('google_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })

    ctx.res.setCookie('google_code_verifier', codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    })

    return { url: url.toString() }
  }),

  /**
   * Handle Google OAuth callback
   * Exchanges code for tokens, creates/updates user, and creates session
   */
  googleCallback: publicProcedure
    .input(
      z.object({
        code: z.string(),
        state: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify state
      const storedState = ctx.req.cookies.google_oauth_state
      const storedCodeVerifier = ctx.req.cookies.google_code_verifier

      if (!storedState || !storedCodeVerifier || storedState !== input.state) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid OAuth state',
        })
      }

      try {
        // Exchange code for tokens
        const tokens = await google.validateAuthorizationCode(input.code, storedCodeVerifier)

        // Fetch user info from Google
        const googleUserResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${tokens.accessToken()}`,
          },
        })

        const googleUser = (await googleUserResponse.json()) as {
          id: string
          email: string
          name?: string
          picture?: string
        }

        // Find or create user
        let user = await prisma.user.findUnique({
          where: { email: googleUser.email },
        })

        if (!user) {
          user = await prisma.user.create({
            data: {
              email: googleUser.email,
              name: googleUser.name,
            },
          })
        }

        // Store encrypted calendar connection tokens
        await prisma.calendarConnection.upsert({
          where: {
            userId: user.id,
          },
          create: {
            userId: user.id,
            provider: 'google',
            accessToken: encrypt(tokens.accessToken()),
            refreshToken: tokens.refreshToken() ? encrypt(tokens.refreshToken()!) : null,
            expiresAt: tokens.accessTokenExpiresAt(),
          },
          update: {
            accessToken: encrypt(tokens.accessToken()),
            refreshToken: tokens.refreshToken() ? encrypt(tokens.refreshToken()!) : null,
            expiresAt: tokens.accessTokenExpiresAt(),
          },
        })

        // Create session
        const session = await lucia.createSession(user.id, {})
        const sessionCookie = lucia.createSessionCookie(session.id)
        ctx.res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

        // Clear OAuth cookies
        ctx.res.clearCookie('google_oauth_state')
        ctx.res.clearCookie('google_code_verifier')

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        }
      } catch (error) {
        console.error('Google OAuth error:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to complete Google authentication',
        })
      }
    }),
})
