import { router, publicProcedure, protectedProcedure } from '../lib/trpc'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { prisma } from 'database'
import { auth } from '../auth/better-auth'
import { APIError } from 'better-auth/api'

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
        emailVerified: ctx.user.emailVerified,
        rmUserId: (ctx.user as any).rmUserId, // Custom field
      },
    }
  }),

  /**
   * Sign up with email and password
   * With email verification enabled, user must verify email before logging in
   */
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Better-Auth returns user object and automatically handles cookies
        const response = await auth.api.signUpEmail({
          body: {
            email: input.email,
            password: input.password,
            name: input.name || input.email.split('@')[0], // Use email username as default
          },
        })

        // NOTE: With email verification enabled, user cannot login until email is verified
        // Better-Auth will send verification email automatically
        return {
          success: true,
          requiresEmailVerification: true,
          user: {
            id: response.user.id,
            email: response.user.email,
            name: response.user.name,
          },
        }
      } catch (error) {
        if (error instanceof APIError) {
          if (error.body?.code?.includes('USER_ALREADY_EXISTS')) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'User with this email already exists'
            })
          }
        }
        console.error('[Auth] Signup error:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create account',
        })
      }
    }),

  /**
   * Login with email and password
   *
   * NOTE: Cookie handling in Next.js with tRPC:
   * Better-Auth sets cookies automatically via its API routes.
   * This endpoint validates credentials and Better-Auth handles the session cookie.
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Better-Auth returns user and automatically sets session cookies
        const response = await auth.api.signInEmail({
          body: {
            email: input.email,
            password: input.password,
          },
        })

        return {
          success: true,
          user: {
            id: response.user.id,
            email: response.user.email,
            name: response.user.name,
          },
        }
      } catch (error) {
        console.error('[Auth] Login error:', error)
        // Generic error message to prevent user enumeration
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        })
      }
    }),

  /**
   * Logout - invalidate session
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      // Better-Auth handles session invalidation and cookie clearing
      await auth.api.signOut({
        headers: ctx.req.headers as any,
      })

      return { success: true }
    } catch (error) {
      console.error('[Auth] Logout error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to logout',
      })
    }
  }),

  /**
   * Initiate Google OAuth flow
   * Returns authorization URL to redirect user to
   */
  googleOAuth: publicProcedure.mutation(async () => {
    try {
      // Better-Auth generates OAuth URL with proper state and PKCE
      // The redirect is handled automatically to /api/auth/callback/google
      const redirectUrl = `${process.env.API_URL || 'http://localhost:3002'}/api/auth/signin/google`

      return { url: redirectUrl }
    } catch (error) {
      console.error('[Auth] Google OAuth initiation error:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to initiate Google authentication',
      })
    }
  }),

  /**
   * Handle Google OAuth callback
   * NOTE: This may not be needed as Better-Auth handles OAuth callbacks automatically
   * at /api/auth/callback/google. Keeping for compatibility but may be deprecated.
   */
  googleCallback: publicProcedure
    .input(
      z.object({
        code: z.string().optional(),
        state: z.string().optional(),
      })
    )
    .mutation(async ({ ctx }) => {
      // Better-Auth handles OAuth callback automatically via its built-in routes
      // This endpoint is here for compatibility but may not be actively used
      // Users should be redirected to /api/auth/callback/google instead

      // Check if user is now authenticated after OAuth
      try {
        const session = await auth.api.getSession({
          headers: ctx.req.headers as any,
        })

        if (session && session.user) {
          // Create CalendarConnection for calendar-specific metadata
          // OAuth tokens are stored in Account table by Better-Auth
          const timezone = 'UTC' // Default - TODO: fetch from Google Calendar API

          await prisma.calendarConnection.upsert({
            where: {
              userId_provider: {
                userId: session.user.id,
                provider: "google",
              },
            },
            create: {
              userId: session.user.id,
              provider: "google",
              timezone,
            },
            update: {
              // Don't overwrite timezone on reconnect - preserve user's setting
              // Only use timezone on initial connection (handled by create)
            },
          })


          return {
            success: true,
            user: {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
            },
          }
        }

        throw new Error('No session found after OAuth')
      } catch (error: any) {
        console.error('[Auth] Google OAuth callback error:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to complete Google authentication',
        })
      }
    }),

  /**
   * Email verification endpoint
   * Verifies email address using token from verification email
   */
  verifyEmail: publicProcedure
    .input(
      z.object({
        token: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        // Better-Auth handles email verification with just the token
        await auth.api.verifyEmail({
          query: {
            token: input.token,
          },
        })

        return { success: true }
      } catch (error) {
        console.error('[Auth] Email verification error:', error)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid or expired verification token',
        })
      }
    }),

  /**
   * Update RM User ID for current user
   * Used by RM integration to link time-tracker user to RM system
   */
  updateRMUserId: protectedProcedure
    .input(
      z.object({
        rmUserId: z.number().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await prisma.user.update({
        where: { id: ctx.user.id },
        data: { rmUserId: input.rmUserId },
      })

      return { success: true }
    }),
})
