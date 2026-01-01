import { router } from '../lib/trpc'

// Routers will be imported and added here as we migrate them
import { authRouter } from './auth'
// import { projectRouter } from './project'
// import { calendarRouter } from './calendar'
// import { timesheetRouter } from './timesheet'
// import { suggestionsRouter } from './suggestions'
// import { analyticsRouter } from './analytics'
// import { rmRouter } from './rm'

export const appRouter = router({
  // Routers will be added incrementally during migration
  auth: authRouter,
  // project: projectRouter,
  // calendar: calendarRouter,
  // timesheet: timesheetRouter,
  // suggestions: suggestionsRouter,
  // analytics: analyticsRouter,
  // rm: rmRouter,
})

export type AppRouter = typeof appRouter
