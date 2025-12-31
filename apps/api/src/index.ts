import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './routers/index.js'
import { createContext } from './context.js'
// NOTE: Calendar sync and session cleanup jobs commented out - Redis needs read-write access
// import { initializeCalendarSyncJobs, shutdownCalendarSyncJobs } from './jobs/calendar-sync-job.js'
// import { initializeSessionCleanupJobs, shutdownSessionCleanupJobs } from './jobs/session-cleanup-job.js'

export type { AppRouter } from './routers/index.js'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001
const HOST = process.env.HOST || '0.0.0.0'

const server = Fastify({
  logger: true,
  maxParamLength: 5000,
})

// Register plugins
await server.register(cors, {
  // Support multiple origins for production (Vercel) and development (localhost)
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin requests, curl, etc.)
    if (!origin) {
      cb(null, true)
      return
    }

    // Allow localhost for development
    if (origin.startsWith('http://localhost:')) {
      cb(null, true)
      return
    }

    // Allow all Vercel deployments (production and preview)
    if (origin.endsWith('.vercel.app')) {
      cb(null, true)
      return
    }

    // Allow custom frontend URL if specified
    if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) {
      cb(null, true)
      return
    }

    // Block all other origins
    console.warn(`[CORS] Blocked request from origin: ${origin}`)
    cb(new Error('Not allowed by CORS'), false)
  },
  credentials: true,
})

await server.register(cookie)

// Register rate limiting
// In production: per-IP limiting with higher limits for concurrent users
// In development: localhost is allowed without rate limiting
await server.register(rateLimit, {
  max: 200, // Increased from 100 for 8 concurrent users
  timeWindow: '1 minute',
  cache: 10000,
  // Per-IP rate limiting instead of global
  keyGenerator: (request) => {
    return request.ip || request.headers['x-forwarded-for'] as string || 'unknown'
  },
  // Only allowlist localhost in development
  allowList: process.env.NODE_ENV !== 'production' ? ['127.0.0.1'] : [],
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
})

// Security: Log sanitization - never log Authorization header to prevent API key leakage
server.addHook('onRequest', async (request, _reply) => {
  const sanitized = { ...request.headers }
  if (sanitized.authorization) {
    sanitized.authorization = '[REDACTED]'
  }
  request.log.info({
    method: request.method,
    url: request.url,
    headers: sanitized,
  })
})

// Security: HTTPS enforcement for API key authentication in production
server.addHook('onRequest', async (request, reply) => {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.authorization
    const isHttps = request.headers['x-forwarded-proto'] === 'https' || request.protocol === 'https'

    if (authHeader && !isHttps) {
      reply.code(400).send({
        error: 'API key authentication requires HTTPS',
      })
    }
  }
})

// Register tRPC
await server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext,
  },
})

// Health check endpoint - verifies database and Redis connectivity
server.get('/health', async () => {
  const checks: Record<string, string> = {}
  let healthy = true

  // Check database connectivity
  try {
    const { prisma } = await import('database')
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch (error) {
    checks.database = 'error'
    healthy = false
    console.error('[Health Check] Database connection failed:', error)
  }

  // Check Redis connectivity (BullMQ) - DISABLED to save Redis quota
  // try {
  //   const { calendarSyncQueue } = await import('./jobs/calendar-sync-job.js')
  //   const isPaused = await calendarSyncQueue.isPaused()
  //   checks.redis = isPaused ? 'paused' : 'ok'
  // } catch (error) {
  //   checks.redis = 'error'
  //   healthy = false
  //   console.error('[Health Check] Redis connection failed:', error)
  // }
  checks.redis = 'disabled'

  const status = healthy ? 'ok' : 'degraded'

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development',
  }
})

// NOTE: OAuth callback removed - Better-Auth handles OAuth flow automatically
// Users authenticate via Better-Auth endpoints (see auth router)
// Calendar connections are now linked to Better-Auth Account records

// Start server
try {
  // Validate database connection before starting
  console.log('[Startup] Validating database connection...')
  const { prisma } = await import('database')
  try {
    await prisma.$queryRaw`SELECT 1`
    console.log('[Startup] Database connection validated')
  } catch (dbError) {
    console.error('[Startup] Database connection failed:', dbError)
    // In production, fail fast if database is not available
    if (process.env.NODE_ENV === 'production') {
      console.error('[Startup] Database is required in production. Exiting...')
      process.exit(1)
    } else {
      console.warn('[Startup] Continuing without database validation (development mode)')
      console.warn('[Startup] Warning: Database operations will fail until connection is restored')
    }
  }

  // Validate Redis connection before starting (in production)
  // DISABLED: Skipping Redis validation to avoid consuming quota
  // if (process.env.NODE_ENV === 'production' || process.env.REDIS_URL) {
  //   console.log('[Startup] Validating Redis connection...')
  //   try {
  //     const { calendarSyncQueue } = await import('./jobs/calendar-sync-job.js')
  //     // Try to check queue status - this will fail if Redis is not available
  //     await calendarSyncQueue.getJobCounts()
  //     console.log('[Startup] Redis connection validated')
  //   } catch (redisError) {
  //     console.error('[Startup] Redis connection failed:', redisError)
  //     console.error('[Startup] BullMQ requires Redis for background jobs. Please check REDIS_URL.')
  //     // In production, fail fast if Redis is not available
  //     if (process.env.NODE_ENV === 'production') {
  //       process.exit(1)
  //     } else {
  //       console.warn('[Startup] Continuing without Redis (development mode)')
  //     }
  //   }
  // }
  console.log('[Startup] Skipping Redis validation (background jobs disabled)')

  await server.listen({ port: PORT, host: HOST })
  console.log(`Server listening on http://${HOST}:${PORT}`)

  // Initialize background jobs
  // DISABLED: BullMQ jobs consume too many Redis requests on Upstash free tier
  // Re-enable when Redis is upgraded or switch to on-demand sync
  // if (process.env.NODE_ENV !== 'test') {
  //   await Promise.all([
  //     initializeCalendarSyncJobs(),
  //     initializeSessionCleanupJobs(),
  //   ])
  //   console.log('Background jobs initialized')
  // }
  console.log('Background jobs disabled (Redis quota limit)')
} catch (err) {
  server.log.error(err)
  process.exit(1)
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM']
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`)

    try {
      // Shutdown background jobs (disabled - see startup section)
      // await Promise.all([
      //   shutdownCalendarSyncJobs(),
      //   shutdownSessionCleanupJobs(),
      // ])

      // Close server
      await server.close()

      console.log('Shutdown complete')
      process.exit(0)
    } catch (err) {
      console.error('Error during shutdown:', err)
      process.exit(1)
    }
  })
})
