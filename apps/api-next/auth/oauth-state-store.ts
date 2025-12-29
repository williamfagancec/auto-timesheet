import { prisma } from 'database'

/**
 * Database-backed OAuth state store (replaces in-memory Map for serverless)
 *
 * In serverless environments, in-memory Maps are lost between function invocations.
 * This implementation uses the database to persist OAuth state across requests.
 */

export async function storeOAuthState(state: string, codeVerifier: string): Promise<void> {
  await prisma.oAuthState.create({
    data: {
      state,
      codeVerifier,
      provider: 'google',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  })
  console.log(`[OAuth State Store] Stored state in DB: ${state.substring(0, 10)}...`)
}

export async function getOAuthState(state: string): Promise<{ state: string; codeVerifier: string } | null> {
  const stored = await prisma.oAuthState.findUnique({
    where: { state },
  })

  if (!stored) {
    console.log(`[OAuth State Store] State not found in DB: ${state.substring(0, 10)}...`)
    return null
  }

  if (stored.expiresAt < new Date()) {
    console.log(`[OAuth State Store] State expired: ${state.substring(0, 10)}...`)
    await prisma.oAuthState.delete({ where: { id: stored.id } })
    return null
  }

  console.log(`[OAuth State Store] Retrieved state from DB: ${state.substring(0, 10)}...`)

  // Delete after retrieval (one-time use for security)
  await prisma.oAuthState.delete({ where: { id: stored.id } })

  return {
    state: stored.state,
    codeVerifier: stored.codeVerifier,
  }
}

/**
 * Cleanup expired OAuth states (called by session cleanup cron)
 */
export async function cleanupExpiredOAuthStates(): Promise<number> {
  const result = await prisma.oAuthState.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  })
  console.log(`[OAuth State Store] Cleaned up ${result.count} expired states`)
  return result.count
}
