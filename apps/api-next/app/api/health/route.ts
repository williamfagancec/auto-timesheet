import { NextResponse } from 'next/server'
import { prisma } from 'database'

// Mark as dynamic route (don't prerender during build)
export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, string> = {}
  let healthy = true

  // Check database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch (error) {
    checks.database = 'error'
    healthy = false
    console.error('[Health Check] Database connection failed:', error)
  }

  // Redis check disabled (quota limit on free tier)
  checks.redis = 'disabled'

  const status = healthy ? 'ok' : 'degraded'

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
    version: process.env.npm_package_version || '0.1.0',
    environment: process.env.NODE_ENV || 'development',
  })
}
