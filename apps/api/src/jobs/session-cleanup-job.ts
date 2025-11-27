import { Queue, Worker } from 'bullmq'
import { error } from 'console'
import { prisma } from 'database'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Parse Redis URL to get connection config
function getRedisConfig() {
  const url = new URL(REDIS_URL)
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  }
}

const redisConnection = getRedisConfig()

/**
 * Queue for session cleanup jobs
 */
export const sessionCleanupQueue = new Queue('session-cleanup', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 10000, // 10 seconds
    },
    removeOnComplete: {
      age: 7 * 24 * 3600, // Keep completed jobs for 7 days
      count: 100,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
})

/**
 * Worker to process session cleanup jobs
 */
export const sessionCleanupWorker = new Worker(
  'session-cleanup',
  async (job) => {
    if (job.name === 'cleanup-expired-sessions') {
      console.log('[SessionCleanupJob] Starting cleanup of expired sessions')

      try {
        // Delete sessions that have expired
        // Lucia stores expiresAt as a timestamp
        const result = await prisma.session.deleteMany({
          where: {
            expiresAt: {
              lt: new Date(), // Less than now = expired
            },
          },
        })

        console.log(`[SessionCleanupJob] Deleted ${result.count} expired sessions`)

        return { deletedSessions: result.count }
      } catch (error) {
        console.error('[SessionCleanupJob] Failed to cleanup sessions:', error)
        throw error
      }
    }

    console.warn(`[SessionCleanupJob] Ignoring unknown job name: ${job.name}`)
    return
  },
  {
    connection: redisConnection,
    concurrency: 1, // Only run one cleanup job at a time
  }
)

// Log worker events
sessionCleanupWorker.on('completed', (job, result) => {
  console.log(`[SessionCleanupJob] Job ${job.id} completed:`, result)
})

sessionCleanupWorker.on('failed', (job, error) => {
  console.error(`[SessionCleanupJob] Job ${job?.id} failed:`, error)
})

/**
 * Setup recurring session cleanup job
 * Runs every 6 hours to clean up expired sessions
 */
export async function setupRecurringSessionCleanup() {
  // Remove any existing recurring job
  await sessionCleanupQueue.removeRepeatable('cleanup-expired-sessions', {
    pattern: '0 */6 * * *', // Every 6 hours
  })

  // Add new recurring job
  await sessionCleanupQueue.add(
    'cleanup-expired-sessions',
    {},
    {
      repeat: {
        pattern: '0 */6 * * *', // Every 6 hours (at minute 0)
      },
    }
  )

  console.log('[SessionCleanupJob] Recurring cleanup job scheduled (every 6 hours)')
}

/**
 * Initialize the session cleanup job system
 */
export async function initializeSessionCleanupJobs() {
  console.log('[SessionCleanupJob] Initializing session cleanup jobs')

 try {
  // Setup recurring cleanup
  await setupRecurringSessionCleanup()
  // Run initial cleanup
  await sessionCleanupQueue.add('cleanup-expired-sessions', {})
  console.log('[sessionCleanupJob] Session cleanup jobs initialised')
 } catch (error) {
  console.error('[SessionCleanupJob] Failed to initalise:', error)
  throw error
 }
}


/**
 * Graceful shutdown
 */
export async function shutdownSessionCleanupJobs() {
  console.log('[SessionCleanupJob] Shutting down workers...')
  await sessionCleanupWorker.close()
  await sessionCleanupQueue.close()
  console.log('[SessionCleanupJob] Workers shut down')
}
