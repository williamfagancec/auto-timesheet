import { initTRPC, TRPCError } from '@trpc/server'
import { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

/**
 * Protected procedure - requires authentication
 * Accepts either session-based auth (cookies) or API key-based auth (headers)
 * Throws UNAUTHORIZED error if user is not authenticated via either method
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // Accept either session OR API key auth
  if (!ctx.user || (!ctx.session && ctx.authMethod !== 'api_key')) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  // Optional: Log API key usage for monitoring
  if (ctx.authMethod === 'api_key') {
    console.log('[Auth] API key access:', {
      userId: ctx.user.id,
      email: ctx.user.email,
    })
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  })
})
