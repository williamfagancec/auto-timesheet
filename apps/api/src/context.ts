import { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'

export async function createContext({ req, res }: CreateFastifyContextOptions) {
  // TODO: Add user session validation here
  return {
    req,
    res,
    user: null, // Will be populated after auth is implemented
  }
}

export type Context = Awaited<ReturnType<typeof createContext>>
