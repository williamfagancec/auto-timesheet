import { router, publicProcedure } from '../trpc.js'
import { z } from 'zod'

export const calendarRouter = router({
  status: publicProcedure.query(async () => {
    return { connected: false }
  }),
  // TODO: Implement calendar procedures
  // - list
  // - sync
  // - updateSettings
})
