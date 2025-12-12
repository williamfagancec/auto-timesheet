import { PrismaClient } from '@prisma/client'

declare global {
  var prisma: PrismaClient | undefined
}

export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' }
      ]
    : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'pgbouncer=true',
    },
  },
})

// Log slow queries in development (>100ms)
if (process.env.NODE_ENV === 'development') {
  // @ts-expect-error - query event not in default types
  prisma.$on('query', (e: { duration: number; query: string }) => {
    if (e.duration > 100) {
      console.log(`[Slow Query] ${e.duration}ms: ${e.query.substring(0, 100)}...`)
    }
  })
}

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

export * from '@prisma/client'
