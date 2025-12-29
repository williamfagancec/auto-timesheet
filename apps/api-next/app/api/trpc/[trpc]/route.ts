import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../../../../routers'
import { createContext } from '../../../../lib/context'
import { NextRequest } from 'next/server'

// Mark as dynamic route (don't prerender during build)
export const dynamic = 'force-dynamic'

const handler = async (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            console.error(`❌ tRPC failed on ${path ?? '<no-path>'}:`, error.message)
          }
        : undefined,
  })
}

export { handler as GET, handler as POST }
