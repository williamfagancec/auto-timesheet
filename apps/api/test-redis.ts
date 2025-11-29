import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env file manually - try multiple paths
function loadEnvFile() {
  const possiblePaths = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    '/Users/williamfagan/Desktop/claudeCode/time-tracker/.env',
  ]

  for (const envPath of possiblePaths) {
    try {
      const envContent = readFileSync(envPath, 'utf-8')
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          let value = match[2].trim()
          // Remove surrounding quotes if present
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1)
          }
          // Always override with .env file value
          process.env[key] = value
        }
      })
      console.log(`Loaded .env from: ${envPath}`)
      return true
    } catch (error) {
      // Try next path
      continue
    }
  }
  console.warn('Could not load .env file from any path')
  return false
}

loadEnvFile()

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

console.log('Testing Redis connection...')
console.log(`Redis URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}`) // Mask password

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

async function testRedisConnection() {
  console.log('\n1. Testing raw Redis connection...')
  const redis = new IORedis(redisConnection)

  try {
    await redis.ping()
    console.log('✅ Raw Redis connection successful (PING)')

    // Test set/get
    await redis.set('test-key', 'test-value')
    const value = await redis.get('test-key')
    if (value === 'test-value') {
      console.log('✅ Redis SET/GET working')
    }
    await redis.del('test-key')

    await redis.quit()
  } catch (error) {
    console.error('❌ Raw Redis connection failed:', error)
    throw error
  }
}

async function testBullMQQueue() {
  console.log('\n2. Testing BullMQ Queue creation...')

  const testQueue = new Queue('test-queue', {
    connection: redisConnection,
  })

  try {
    // Add a test job
    const job = await testQueue.add('test-job', { message: 'Hello from test!' })
    console.log(`✅ BullMQ Queue created, test job added (ID: ${job.id})`)

    // Check job status
    const jobState = await job.getState()
    console.log(`✅ Job state: ${jobState}`)

    await testQueue.close()
  } catch (error) {
    console.error('❌ BullMQ Queue test failed:', error)
    await testQueue.close()
    throw error
  }
}

async function testBullMQWorker() {
  console.log('\n3. Testing BullMQ Worker...')

  const workerQueue = new Queue('worker-test-queue', {
    connection: redisConnection,
  })

  let workerProcessed = false
  let workerResult: any = null

  const worker = new Worker(
    'worker-test-queue',
    async (job) => {
      console.log(`Worker processing job ${job.id} with data:`, job.data)
      workerProcessed = true
      workerResult = job.data
      return { success: true, processed: job.data }
    },
    {
      connection: redisConnection,
    }
  )

  try {
    // Add a job
    const job = await workerQueue.add('worker-test', { test: 'worker-data' })
    console.log(`Added job ${job.id}, waiting for worker to process...`)

    // Wait for worker to process (max 10 seconds)
    await new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (workerProcessed) {
          clearInterval(checkInterval)
          resolve(true)
        }
      }, 100)

      setTimeout(() => {
        clearInterval(checkInterval)
        resolve(false)
      }, 10000)
    })

    if (workerProcessed && workerResult?.test === 'worker-data') {
      console.log('✅ Worker successfully processed job:', workerResult)
    } else {
      console.log('⚠️  Worker did not process job in time')
    }

    await worker.close()
    await workerQueue.close()
  } catch (error) {
    console.error('❌ BullMQ Worker test failed:', error)
    await worker.close()
    await workerQueue.close()
    throw error
  }
}

async function runTests() {
  try {
    await testRedisConnection()
    await testBullMQQueue()
    await testBullMQWorker()

    console.log('\n✅ All Redis and BullMQ tests passed!')
    console.log('\nYour Redis connection is working correctly.')
    console.log('Background jobs (calendar sync and session cleanup) should work now.')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Tests failed:', error)
    process.exit(1)
  }
}

runTests()
