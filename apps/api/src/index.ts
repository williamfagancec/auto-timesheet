import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { appRouter } from './routers/index.js'
import { createContext } from './context.js'
import { initializeCalendarSyncJobs, shutdownCalendarSyncJobs } from './jobs/calendar-sync-job.js'
import { initializeSessionCleanupJobs, shutdownSessionCleanupJobs } from './jobs/session-cleanup-job.js'
import { getOAuthState } from './auth/oauth-state-store.js'

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

// Google OAuth callback endpoint - handles the full OAuth flow
server.get('/auth/google/callback', async (request, reply) => {
  const { code, state } = request.query as { code?: string; state?: string }
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

  console.log('[OAuth Callback] Received callback:', { code: code?.substring(0, 20) + '...', state })

  if (!code || !state) {
    console.error('[OAuth Callback] Missing code or state')
    return reply.redirect(`${frontendUrl}/login?error=missing_oauth_params`)
  }

  try {
    // Get stored state and code verifier from in-memory store
    const storedOAuth = getOAuthState(state)

    if (!storedOAuth) {
      console.error('[OAuth Callback] OAuth state validation failed: state not found or expired')
      return reply.redirect(`${frontendUrl}/login?error=invalid_oauth_state`)
    }

    console.log('[OAuth Callback] OAuth state validated successfully')

    // Exchange code for tokens
    const { google } = await import('./auth/google.js')
    const { encrypt } = await import('./auth/encryption.js')
    const { lucia } = await import('./auth/lucia.js')
    const { prisma } = await import('database')

    const tokens = await google.validateAuthorizationCode(code, storedOAuth.codeVerifier)

    // Log token status for debugging
    console.log('[OAuth Callback] Token validation', {
      hasAccessToken: !!tokens.accessToken(),
      hasRefreshToken: !!tokens.refreshToken(),
      accessTokenLength: tokens.accessToken()?.length,
      expiresAt: tokens.accessTokenExpiresAt(),
    })

    // Fetch user info from Google
    const googleUserResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken()}`,
      },
    })

    if (!googleUserResponse.ok) {
      const errorText = await googleUserResponse.text()
      console.error('[OAuth Callback] Failed to fetch Google user info:', googleUserResponse.status, errorText)
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`)
    }

    let googleUser: {
      id: string
      email: string
      name?: string
      picture?: string
    }

    try {
      const responseText = await googleUserResponse.text()
      console.log('[OAuth Callback] Google user info response length:', responseText.length)
      console.log('[OAuth Callback] Google user info response preview:', responseText.substring(0, 200))
      googleUser = JSON.parse(responseText)
    } catch (jsonError) {
      console.error('[OAuth Callback] Failed to parse Google user info JSON:', jsonError)
      console.error('[OAuth Callback] Response status:', googleUserResponse.status)
      console.error('[OAuth Callback] Response headers:', Object.fromEntries(googleUserResponse.headers.entries()))
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`)
    }

    if (!googleUser.email) {
      console.error('[OAuth Callback] No email in Google user info')
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`)
    }

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
        },
      })
    }

    // Handle refresh token (Google only returns it on first authorization or if prompt=consent)
    let encryptedRefreshToken: string | null = null
    try {
      const refreshToken = tokens.refreshToken()
      if (refreshToken) {
        encryptedRefreshToken = encrypt(refreshToken)
      }
    } catch (error) {
      // No refresh token provided by Google (not the first authorization)
      console.log('[OAuth Callback] No refresh token provided by Google (this is normal for subsequent authorizations)')
    }

    // Store encrypted calendar connection tokens
    await prisma.calendarConnection.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: 'google',
        },
      },
      create: {
        userId: user.id,
        provider: 'google',
        accessToken: encrypt(tokens.accessToken()),
        refreshToken: encryptedRefreshToken,
        expiresAt: tokens.accessTokenExpiresAt(),
      },
      update: {
        accessToken: encrypt(tokens.accessToken()),
        // Only update refresh token if we got a new one
        ...(encryptedRefreshToken ? { refreshToken: encryptedRefreshToken } : {}),
        expiresAt: tokens.accessTokenExpiresAt(),
      },
    })

    // Create session
    const session = await lucia.createSession(user.id, {})
    const sessionCookie = lucia.createSessionCookie(session.id)
    reply.setCookie(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

    console.log('[OAuth Callback] Session created:', {
      user: user.email,
      sessionId: session.id.substring(0, 20) + '...',
      cookieName: sessionCookie.name,
      cookieAttributes: sessionCookie.attributes,
    })

    console.log(`[OAuth Callback] Successfully authenticated user ${user.email}`)

    // Redirect to the events page on success
    return reply.redirect(`${frontendUrl}/events`)
  } catch (error) {
    console.error('[OAuth Callback Error]', error)
    return reply.redirect(`${frontendUrl}/login?error=oauth_failed`)
  }
})

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
