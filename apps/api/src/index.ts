import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './routers/index.js'
import { createContext } from './context.js'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001
const HOST = process.env.HOST || '0.0.0.0'

const server = Fastify({
  logger: true,
  maxParamLength: 5000,
})

// Register plugins
await server.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
})

await server.register(cookie)

// Register tRPC
await server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
})

// Health check endpoint
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Start server
try {
  await server.listen({ port: PORT, host: HOST })
  console.log(`Server listening on http://${HOST}:${PORT}`)
} catch (err) {
  server.log.error(err)
  process.exit(1)
}
