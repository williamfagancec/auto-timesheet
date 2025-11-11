import { createClient, RedisClientType } from 'redis'

/**
 * Shared Redis client with graceful degradation support
 *
 * Auto-detects Redis availability and falls back gracefully if unavailable.
 * Designed for multi-layer caching with in-memory fallback.
 */
export class RedisClient {
  private client: RedisClientType | null = null
  private isAvailable: boolean = false
  private connectionAttempted: boolean = false

  constructor() {
    if (!process.env.REDIS_URL) {
      console.warn('[Redis] REDIS_URL not configured, distributed caching disabled')
      return
    }

    try {
      this.client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            // Stop retrying after 3 attempts
            if (retries > 3) {
              console.error('[Redis] Max reconnection attempts reached, giving up')
              return false
            }
            // Exponential backoff: 50ms, 100ms, 200ms
            const delay = Math.min(retries * 50, 500)
            console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})`)
            return delay
          },
          connectTimeout: 5000, // 5 seconds
        },
      })

      this.client.on('connect', () => {
        this.isAvailable = true
        console.log('[Redis] Connected successfully')
      })

      this.client.on('ready', () => {
        this.isAvailable = true
        console.log('[Redis] Client ready')
      })

      this.client.on('error', (err) => {
        this.isAvailable = false
        console.error('[Redis] Error:', err.message)
      })

      this.client.on('end', () => {
        this.isAvailable = false
        console.warn('[Redis] Connection closed')
      })

      // Attempt initial connection (lazy)
      this.connect()
    } catch (err) {
      console.error('[Redis] Initialization error:', err)
      this.isAvailable = false
    }
  }

  /**
   * Attempt to connect to Redis
   */
  private async connect(): Promise<void> {
    if (!this.client || this.connectionAttempted) return

    this.connectionAttempted = true

    try {
      await this.client.connect()
      this.isAvailable = true
    } catch (err) {
      console.error('[Redis] Initial connection failed:', err)
      this.isAvailable = false
    }
  }

  /**
   * Get value from Redis cache
   * Returns null if key doesn't exist or Redis is unavailable
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isAvailable) {
      return null
    }

    try {
      const value = await this.client.get(key)
      if (!value) return null

      return JSON.parse(value) as T
    } catch (err) {
      console.error('[Redis] Get error:', err, { key })
      return null
    }
  }

  /**
   * Set value in Redis cache with TTL
   * Returns true if successful, false if Redis is unavailable
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.isAvailable) {
      return false
    }

    try {
      await this.client.set(key, JSON.stringify(value), {
        EX: ttlSeconds,
      })
      return true
    } catch (err) {
      console.error('[Redis] Set error:', err, { key, ttlSeconds })
      return false
    }
  }

  /**
   * Delete single key from Redis
   * Returns true if successful, false if Redis is unavailable
   */
  async del(key: string): Promise<boolean> {
    if (!this.client || !this.isAvailable) {
      return false
    }

    try {
      await this.client.del(key)
      return true
    } catch (err) {
      console.error('[Redis] Delete error:', err, { key })
      return false
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * Returns number of keys deleted, 0 if Redis is unavailable
   *
   * WARNING: Uses KEYS command which can be slow on large datasets.
   * Acceptable for MVP with short TTLs and low key counts.
   */
  async delPattern(pattern: string): Promise<number> {
    if (!this.client || !this.isAvailable) {
      return 0
    }

    try {
      // KEYS is acceptable for MVP, but consider SCAN for production scale
      const keys = await this.client.keys(pattern)
      if (keys.length === 0) return 0

      await this.client.del(keys)
      return keys.length
    } catch (err) {
      console.error('[Redis] Delete pattern error:', err, { pattern })
      return 0
    }
  }

  /**
   * Check if Redis is currently connected and available
   */
  isConnected(): boolean {
    return this.isAvailable
  }

  /**
   * Get Redis connection mode for observability
   */
  getMode(): 'distributed' | 'unavailable' {
    return this.isAvailable ? 'distributed' : 'unavailable'
  }

  /**
   * Gracefully close Redis connection (for shutdown)
   */
  async disconnect(): Promise<void> {
    if (!this.client) return

    try {
      await this.client.quit()
      this.isAvailable = false
      console.log('[Redis] Disconnected gracefully')
    } catch (err) {
      console.error('[Redis] Disconnect error:', err)
    }
  }
}

// Singleton instance - import and use across the application
export const redisClient = new RedisClient()
