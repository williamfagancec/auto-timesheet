import { createTRPCReact } from '@trpc/react-query'
// TODO: Import AppRouter type from api package when available
// import type { AppRouter } from 'api'

// Placeholder type until API is set up
type AppRouter = any

export const trpc = createTRPCReact<AppRouter>()
