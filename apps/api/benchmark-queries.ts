#!/usr/bin/env npx tsx
/**
 * Database Performance Benchmark Script
 *
 * Measures query execution times for optimized queries.
 * Run with: npx tsx apps/api/benchmark-queries.ts [userId]
 *
 * Requirements:
 * - User must exist in database
 * - User should have calendar events, projects, rules, and suggestion logs
 */

import { prisma } from '@time-tracker/database'

const BENCHMARK_ITERATIONS = 10

interface BenchmarkResult {
  query: string
  avgTime: number
  minTime: number
  maxTime: number
  iterations: number
}

async function measureQuery<T>(
  name: string,
  queryFn: () => Promise<T>
): Promise<BenchmarkResult> {
  const times: number[] = []

  // Warm-up run (not counted)
  await queryFn()

  // Benchmark runs
  for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
    const start = performance.now()
    await queryFn()
    const end = performance.now()
    times.push(end - start)
  }

  return {
    query: name,
    avgTime: times.reduce((a, b) => a + b, 0) / times.length,
    minTime: Math.min(...times),
    maxTime: Math.max(...times),
    iterations: BENCHMARK_ITERATIONS
  }
}

async function runBenchmarks(userId: string) {
  console.log('🚀 Starting Database Performance Benchmarks\n')
  console.log(`User ID: ${userId}`)
  console.log(`Iterations: ${BENCHMARK_ITERATIONS}`)
  console.log(`\n${'='.repeat(80)}\n`)

  const results: BenchmarkResult[] = []

  // 1. Calendar Events - Date Range Query (uses CalendarEvent_date_range_idx)
  console.log('📅 Benchmarking: Calendar Events (Date Range Query)...')
  const weekStart = new Date()
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  results.push(
    await measureQuery('Calendar Events (Date Range)', async () => {
      return await prisma.calendarEvent.findMany({
        where: {
          userId,
          isDeleted: false,
          startTime: { lt: weekEnd },
          endTime: { gt: weekStart }
        }
      })
    })
  )

  // 2. Weekly Timesheet Grid (uses TimesheetEntry_userId_date_idx)
  console.log('📊 Benchmarking: Weekly Timesheet Grid...')
  results.push(
    await measureQuery('Weekly Timesheet Grid', async () => {
      return await prisma.timesheetEntry.findMany({
        where: {
          userId,
          date: { gte: weekStart, lt: weekEnd },
          isSkipped: false
        },
        include: { project: true }
      })
    })
  )

  // 3. AI Rules Fetch (uses CategoryRule indexes + optimized filter)
  console.log('🤖 Benchmarking: AI Rules Fetch (with archive filter)...')
  results.push(
    await measureQuery('AI Rules Fetch', async () => {
      return await prisma.categoryRule.findMany({
        where: {
          userId,
          project: { isArchived: false }
        },
        include: { project: true }
      })
    })
  )

  // 4. Analytics - Suggestion Metrics (uses SuggestionLog_analytics_idx)
  console.log('📈 Benchmarking: Analytics - Suggestion Metrics...')
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  results.push(
    await measureQuery('Analytics - Suggestion Metrics', async () => {
      const [acceptedCount, totalCount, avgConfidence] = await Promise.all([
        prisma.suggestionLog.count({
          where: { userId, outcome: 'ACCEPTED', createdAt: { gte: thirtyDaysAgo } }
        }),
        prisma.suggestionLog.count({
          where: { userId, createdAt: { gte: thirtyDaysAgo } }
        }),
        prisma.suggestionLog.aggregate({
          where: { userId, createdAt: { gte: thirtyDaysAgo } },
          _avg: { confidence: true }
        })
      ])
      return { acceptedCount, totalCount, avgConfidence }
    })
  )

  // 5. Problematic Patterns (uses CategoryRule_performance_idx)
  console.log('⚠️  Benchmarking: Problematic Patterns...')
  results.push(
    await measureQuery('Problematic Patterns', async () => {
      return await prisma.categoryRule.findMany({
        where: {
          userId,
          totalSuggestions: { gte: 3 },
          accuracy: { lt: 0.5 }
        },
        include: { project: true },
        orderBy: [
          { accuracy: 'asc' },
          { totalSuggestions: 'desc' }
        ]
      })
    })
  )

  // 6. Project List (uses Project_userId_lastUsedAt_idx)
  console.log('📁 Benchmarking: Project List...')
  results.push(
    await measureQuery('Project List', async () => {
      return await prisma.project.findMany({
        where: { userId, isArchived: false },
        orderBy: { lastUsedAt: 'desc' }
      })
    })
  )

  console.log(`\n${'='.repeat(80)}\n`)
  console.log('✅ Benchmarks Complete!\n')

  // Print results table
  console.log('Results:\n')
  console.log('┌─────────────────────────────────────┬───────────┬───────────┬───────────┐')
  console.log('│ Query                               │ Avg (ms)  │ Min (ms)  │ Max (ms)  │')
  console.log('├─────────────────────────────────────┼───────────┼───────────┼───────────┤')

  results.forEach(result => {
    const name = result.query.padEnd(35)
    const avg = result.avgTime.toFixed(2).padStart(9)
    const min = result.minTime.toFixed(2).padStart(9)
    const max = result.maxTime.toFixed(2).padStart(9)
    console.log(`│ ${name} │ ${avg} │ ${min} │ ${max} │`)
  })

  console.log('└─────────────────────────────────────┴───────────┴───────────┴───────────┘\n')

  // Summary statistics
  const totalAvg = results.reduce((sum, r) => sum + r.avgTime, 0)
  const overallAvg = totalAvg / results.length

  console.log('Summary:')
  console.log(`  Total Average Time: ${overallAvg.toFixed(2)}ms`)
  console.log(`  Fastest Query: ${results.reduce((min, r) => r.avgTime < min.avgTime ? r : min).query} (${results.reduce((min, r) => r.avgTime < min.avgTime ? r : min).avgTime.toFixed(2)}ms)`)
  console.log(`  Slowest Query: ${results.reduce((max, r) => r.avgTime > max.avgTime ? r : max).query} (${results.reduce((max, r) => r.avgTime > max.avgTime ? r : max).avgTime.toFixed(2)}ms)`)

  console.log('\n💡 Tips:')
  console.log('  - Queries >100ms should be investigated')
  console.log('  - Enable Prisma query logging to see actual SQL')
  console.log('  - Use EXPLAIN ANALYZE to verify index usage')
  console.log('  - Run benchmarks with production-like data volumes\n')
}

async function main() {
  const userId = process.argv[2]

  if (!userId) {
    console.error('❌ Error: Please provide a user ID')
    console.error('\nUsage: npx tsx apps/api/benchmark-queries.ts <userId>')
    console.error('\nExample: npx tsx apps/api/benchmark-queries.ts clabcd1234567890')
    process.exit(1)
  }

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    console.error(`❌ Error: User with ID '${userId}' not found`)
    process.exit(1)
  }

  console.log(`✅ Found user: ${user.email}\n`)

  try {
    await runBenchmarks(userId)
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
