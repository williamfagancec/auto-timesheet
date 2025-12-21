import { Queue, Worker } from 'bullmq'
import { prisma } from 'database'
import { syncUserEvents } from '../services/calendar-sync.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

// Parse Redis URL to get connection config
function getRedisConfig() {
  const url = new URL(REDIS_URL)

  const config: {
    host: string
    port: number
    password?: string
    username?: string
    tls?: object
  } = {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
  }

  // Add credentials if present
  if (url.password) {
    config.password = url.password
  }
  if (url.username && url.username !== 'default') {
    config.username = url.username
  }

  // Enable TLS for rediss:// protocol (Upstash requires this)
  if (url.protocol === 'rediss:') {
    config.tls = {
      // Upstash certificates are valid, but we make this configurable
      // Set REDIS_TLS_REJECT_UNAUTHORIZED=true in env to require cert validation
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'true',
    }
  }

  return config
}

const redisConnection = getRedisConfig()

/**
 * Queue for calendar sync jobs
 */
export const calendarSyncQueue = new Queue('calendar-sync', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 seconds
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
})

/**
 * Worker to process calendar sync jobs
 */
export const calendarSyncWorker = new Worker(
  'calendar-sync',
  async (job) => {
    switch (job.name) {
      case 'sync-user': {
        const { userId } = job.data as { userId: string }

        console.log(`[CalendarSyncJob] Starting sync for user ${userId}`)

        try {
          const result = await syncUserEvents(userId)
          
          console.log(`[CalendarSyncJob] Completed sync for user ${userId}:`, result)

          return result
        } catch (error) {
          console.error(`[CalendarSyncJob] Failed to sync for user ${userId}:`, error)
          throw error
        }
      }
      case 'sync-all-active-users': {
        console.log('[CalendarSyncJob] Running recurring sync for all activite users')
        const count = await scheduleActiveUserSyncs()
        return { scheduledUsers: count }
      }
      default: {
        console.warn(`[CalendarSyncJob] Ignoring unknown job name: ${job.name}`)
        return
      }
    }
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 sync-user jobs concurrently
  }
)

// Log worker events
calendarSyncWorker.on('completed', (job, result) => {
  if (job.name === 'sync-user') {
    console.log(`[CalendarSyncJob] Job ${job.id} completed for user ${job.data.userId}:`, result)
  } else {
    console.log(`[CalendarSyncJob] Job ${job.id} completed:`, result)
  }
})

calendarSyncWorker.on('failed', (job, error) => {
  if (job?.name === 'sync-user') {
    console.log(`[CalendarSyncJob] Job ${job.id} failed for user ${job.data?.userId}:`, error)
  } else {
    console.error(`[CalendarSyncJob] Job ${job?.id} failed:`, error)
  }
})

/**
 * Schedule sync jobs for all active users
 * Active = users with valid calendar connections who've been active in last 24h
 */
export async function scheduleActiveUserSyncs(): Promise<number> {
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Find users with calendar connections
  const allUsersWithCalendars = await prisma.user.findMany({
    where: {
      calendars: {
        some: {
          provider: 'google',
        },
      },
      sessions: {
        some: {
          createdAt: {
            gte: yesterday,
          },
        },
      },
    },
    select: {
      id: true,
    },
  })

  console.log(`[CalendarSyncJob] Found ${allUsersWithCalendars.length} users with recent activity`)
  const activeUsers = allUsersWithCalendars

  console.log(`[CalendarSyncJob] Scheduling sync for ${activeUsers.length} active users`)

  // Add sync job for each user
  for (const user of activeUsers) {
    await calendarSyncQueue.add(
      'sync-user',
      { userId: user.id },
      {
        jobId: `sync-${user.id}`, 
      }
    )
  }

  return activeUsers.length
}

/**
 * Setup recurring job to sync all active users every 15 minutes
 */
export async function setupRecurringSync() {
  // Remove any existing recurring job
  await calendarSyncQueue.removeRepeatable('sync-all-active-users', {
    pattern: '*/15 * * * *', // Every 15 minutes
  })

  // Add new recurring job
  await calendarSyncQueue.add(
    'sync-all-active-users',
    {},
    {
      repeat: {
        pattern: '*/15 * * * *', // Every 15 minutes
      },
    }
  )

  console.log('[CalendarSyncJob] Recurring sync job scheduled (every 15 minutes)')
}


/**
 * Initialize the calendar sync job system
 */
export async function initializeCalendarSyncJobs() {
  console.log('[CalendarSyncJob] Initializing calendar sync jobs')

  // Setup recurring sync
  await setupRecurringSync()

  // Run initial sync for all active users
  await scheduleActiveUserSyncs()

  console.log('[CalendarSyncJob] Calendar sync jobs initialized')
}

/**
 * Graceful shutdown
 */
export async function shutdownCalendarSyncJobs() {
  console.log('[CalendarSyncJob] Shutting down workers...')
  await calendarSyncWorker.close()
  await calendarSyncQueue.close()
  console.log('[CalendarSyncJob] Workers shut down')
}
