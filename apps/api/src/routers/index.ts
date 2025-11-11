import { router } from '../trpc.js'
import { authRouter } from './auth.js'
import { projectRouter } from './project.js'
import { calendarRouter } from './calendar.js'
import { timesheetRouter } from './timesheet.js'
import { suggestionsRouter } from './suggestions.js'
import { analyticsRouter } from './analytics.js'

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  calendar: calendarRouter,
  timesheet: timesheetRouter,
  suggestions: suggestionsRouter,
  analytics: analyticsRouter,
})

export type AppRouter = typeof appRouter