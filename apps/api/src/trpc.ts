import { initTRPC, TRPCError } from '@trpc/server'
import { Context } from './context.js'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

/**
 * Protected procedure - requires authentication
 * Throws UNAUTHORIZED error if user is not logged in
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  })
})
