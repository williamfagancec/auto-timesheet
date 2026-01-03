import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from 'api-next/routers'  // Updated from 'api/router' to use Next.js backend

export const trpc = createTRPCReact<AppRouter>()
