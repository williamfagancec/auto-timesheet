import { router } from '../lib/trpc'

// All routers migrated from Fastify backend
import { authRouter } from './auth'
import { projectRouter } from './project'
import { calendarRouter } from './calendar'
import { timesheetRouter } from './timesheet'
import { suggestionsRouter } from './suggestions'
import { analyticsRouter } from './analytics'
import { rmRouter } from './rm'

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  calendar: calendarRouter,
  timesheet: timesheetRouter,
  suggestions: suggestionsRouter,
  analytics: analyticsRouter,
  rm: rmRouter,
})

export type AppRouter = typeof appRouter
