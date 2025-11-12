import { router, publicProcedure, protectedProcedure } from '../trpc.js'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { prisma } from 'database'
import { Prisma } from '@prisma/client'
import { lucia } from '../auth/lucia.js'
import { hashPassword, verifyPassword } from '../auth/password.js'
import { google, GOOGLE_SCOPES } from '../auth/google.js'
import { encrypt } from '../auth/encryption.js'
import { generateCodeVerifier, generateState } from 'arctic'
import { storeOAuthState } from '../auth/oauth-state-store.js'
import { getUserTimezone } from '../services/google-calendar.js'
import { syncUserEvents } from '../services/calendar-sync.js'

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
      let user
      try {
        user = await prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
            hashedPassword,
          },
        })
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === 'P2002'
        ) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'User with this email already exists',
          })
        }
        throw error
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
   * Returns authorization URL and stores state/code verifier in memory
   */
  googleOAuth: publicProcedure.mutation(async () => {
    const state = generateState()
    const codeVerifier = generateCodeVerifier()

    const url = google.createAuthorizationURL(state, codeVerifier, GOOGLE_SCOPES)

    // Force Google to always return a refresh token
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')

    // Store state and code verifier in memory (avoids cookie issues with cross-site redirects)
    storeOAuthState(state, codeVerifier)

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

     if (process.env.DEBUG_OAUTH === 'true') {
      console.log('[OAuth Debug] Cookies received:', {
        storedState,
        storedCodeVerifier,
        inputState: input.state,
      })
     }

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

        if (!googleUserResponse.ok) {
          const errorText = await googleUserResponse.text()
          console.error('Failed to fetch Google user info:', googleUserResponse.status, errorText)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Failed to fetch Google account details',
          })
        }

        const googleUser = (await googleUserResponse.json()) as {
          id: string
          email: string
          name?: string
          picture?: string
        }

        if (!googleUser.email) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Google account does not have an email',
          })
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

        // Validate and encrypt tokens before storing
        let encryptedAccessToken: string
        let encryptedRefreshToken: string | null = null

        // Log token status for debugging
        const hasRefreshToken = !!tokens.refreshToken()
        console.log('[OAuth] Token validation', {
          userEmail: user.email,
          hasAccessToken: !!tokens.accessToken(),
          hasRefreshToken,
          accessTokenLength: tokens.accessToken()?.length,
          refreshTokenLength: tokens.refreshToken()?.length,
        })

        // Validate access token
        if (!tokens.accessToken() || tokens.accessToken().trim().length === 0) {
          console.error('[OAuth] Invalid access token: empty or null')
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Google returned an invalid access token',
          })
        }

        try {
          encryptedAccessToken = encrypt(tokens.accessToken())

          if (tokens.refreshToken()) {
            // Validate refresh token before encrypting
            if (tokens.refreshToken()!.trim().length === 0) {
              console.error('[OAuth] Refresh token is empty string')
              throw new Error('Refresh token is empty')
            }
            encryptedRefreshToken = encrypt(tokens.refreshToken()!)
            console.log('[OAuth] Successfully encrypted refresh token')
          } else {
            console.warn('[OAuth] No refresh token provided by Google - this may cause sync issues later')
          }
        } catch (encryptError) {
          console.error('[OAuth] Token encryption failed:', encryptError)
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to encrypt OAuth tokens. Please check ENCRYPTION_KEY configuration.',
          })
        }

        // Fetch user's timezone from Google Calendar (with fallback to UTC)
        let timezone = 'UTC'
        try {
          timezone = await getUserTimezone(tokens.accessToken())
          console.log(`Successfully detected timezone for user ${user.email}: ${timezone}`)
        } catch (timezoneError) {
          console.error('Failed to fetch timezone from Google Calendar, using UTC as fallback:', timezoneError)
          // Don't block OAuth flow if timezone fetch fails - continue with UTC
        }

        // Store encrypted calendar connection tokens
        // Check if connection already exists to handle refresh token properly
        const existingConnection = await prisma.calendarConnection.findUnique({
          where: {
            userId_provider: {
              userId: user.id,
              provider: 'google',
            },
          },
          select: { refreshToken: true },
        })

        await prisma.calendarConnection.upsert({
          where: {
            userId_provider: {
              userId: user.id,
              provider: 'google',
            },
          },
          create: {
            userId: user.id,
            provider: 'google',
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt: tokens.accessTokenExpiresAt(),
            timezone,
          },
          update: {
            accessToken: encryptedAccessToken,
            expiresAt: tokens.accessTokenExpiresAt(),
            timezone,
            // CRITICAL: Only update refresh token if Google provided a new one
            // If no new refresh token and no existing one, this is a problem
            // Otherwise, preserve the existing refresh token
            refreshToken: encryptedRefreshToken || existingConnection?.refreshToken || null,
          },
        })

        // Log final status
        console.log('[OAuth] Stored calendar connection', {
          userEmail: user.email,
          hasRefreshToken: !!(encryptedRefreshToken || existingConnection?.refreshToken),
          isNewConnection: !existingConnection,
          providedNewRefreshToken: !!encryptedRefreshToken,
        })

        // Create session
        const session = await lucia.createSession(user.id, {})
        const sessionCookie = lucia.createSessionCookie(session.id)
        ctx.res.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

        // Clear OAuth cookies
        ctx.res.clearCookie('google_oauth_state')
        ctx.res.clearCookie('google_code_verifier')

        console.log(`Successfully authenticated user ${user.email} via Google OAuth`)

        // Trigger automatic calendar sync if user has selected calendars
        // Run this in background - don't block OAuth flow if sync fails
        const calendarConnection = await prisma.calendarConnection.findUnique({
          where: {
            userId_provider: {
              userId: user.id,
              provider: 'google',
            },
          },
        })

        if (calendarConnection?.selectedCalendarIds && (calendarConnection.selectedCalendarIds as string[]).length > 0) {
          console.log(`Triggering automatic calendar sync for user ${user.email}`)
          syncUserEvents(user.id)
            .then((result) => {
              console.log(`Auto-sync completed for ${user.email}: ${result.eventsCreated} created, ${result.eventsUpdated} updated`)
            })
            .catch((error) => {
              console.error(`Auto-sync failed for ${user.email}:`, error)
              // Don't fail the OAuth flow - sync can be retried manually
            })
        } else {
          console.log(`Skipping auto-sync for ${user.email} - no calendars selected yet`)
        }

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

        // If it's already a TRPCError, re-throw it
        if (error instanceof TRPCError) {
          throw error
        }

        // Check for specific Arctic/OAuth errors
        if (error instanceof Error) {
          if (error.message.includes('code_verifier') || error.message.includes('PKCE')) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'OAuth verification failed. Please try authenticating again.',
            })
          }
          if (error.message.includes('invalid_grant')) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'OAuth code expired or invalid. Please try authenticating again.',
            })
          }
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to complete Google authentication. Please try again or contact support.',
        })
      }
    }),
})
