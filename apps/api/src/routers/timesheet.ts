import { router, publicProcedure } from '../trpc.js'
import { z } from 'zod'

export const timesheetRouter = router({
  getEntries: publicProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string() }))
    .query(async () => {
      return []
    }),
  // TODO: Implement timesheet procedures
  // - updateEntry
  // - createManualEntry
  // - skipEntry
  // - bulkCategorize
})
