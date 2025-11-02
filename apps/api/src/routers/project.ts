import { router, publicProcedure } from '../trpc.js'
import { z } from 'zod'

export const projectRouter = router({
  list: publicProcedure.query(async () => {
    return []
  }),
  // TODO: Implement project procedures
  // - create
  // - update
  // - archive
})
