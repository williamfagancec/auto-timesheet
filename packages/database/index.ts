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
    : ['error']
})

// Log slow queries in development (>100ms)
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query' as any, (e: any) => {
    if (e.duration > 100) {
      console.log(`[Slow Query] ${e.duration}ms: ${e.query.substring(0, 100)}...`)
    }
  })
}

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

export * from '@prisma/client'
