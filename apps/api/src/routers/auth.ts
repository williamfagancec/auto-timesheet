import { router, publicProcedure } from '../trpc.js'
import { z } from 'zod'

export const authRouter = router({
  status: publicProcedure.query(async () => {
    return { authenticated: false, user: null }
  }),
  // TODO: Implement auth procedures
  // - signup
  // - login
  // - logout
  // - googleOAuth
  // - googleCallback
})
