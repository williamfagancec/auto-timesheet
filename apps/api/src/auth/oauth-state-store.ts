/**
 * In-memory store for OAuth state and code verifiers
 *
 * This avoids cookie issues with cross-site redirects from Google.
 * States expire after 10 minutes automatically.
 */

interface OAuthState {
  state: string
  codeVerifier: string
  expiresAt: number
}

const stateStore = new Map<string, OAuthState>()

// Cleanup expired states every minute
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of stateStore.entries()) {
    if (value.expiresAt < now) {
      stateStore.delete(key)
    }
  }
}, 60 * 1000)

export function storeOAuthState(state: string, codeVerifier: string): void {
  stateStore.set(state, {
    state,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  })
  console.log(`[OAuth State Store] Stored state: ${state}`)
}

export function getOAuthState(state: string): { state: string; codeVerifier: string } | null {
  const stored = stateStore.get(state)

  if (!stored) {
    console.log(`[OAuth State Store] State not found: ${state}`)
    return null
  }

  if (stored.expiresAt < Date.now()) {
    console.log(`[OAuth State Store] State expired: ${state}`)
    stateStore.delete(state)
    return null
  }

  console.log(`[OAuth State Store] Retrieved state: ${state}`)
  // Delete after retrieval (one-time use)
  stateStore.delete(state)

  return {
    state: stored.state,
    codeVerifier: stored.codeVerifier,
  }
}
