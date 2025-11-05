import { router } from '../trpc.js'
import { authRouter } from './auth.js'
import { projectRouter } from './project.js'
import { calendarRouter } from './calendar.js'
import { timesheetRouter } from './timesheet.js'

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  calendar: calendarRouter,
  timesheet: timesheetRouter,
})

export type AppRouter = typeof appRouter