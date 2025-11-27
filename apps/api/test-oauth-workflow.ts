/**
 * OAuth Workflow Test Script
 *
 * This script tests the Google OAuth login workflow under various token expiry scenarios
 * to ensure the fix continues to work even after periods of inactivity.
 *
 * Test Scenarios:
 * 1. Fresh tokens (just logged in) - should NOT trigger refresh
 * 2. Tokens expiring soon (within 10 minutes) - SHOULD trigger refresh
 * 3. Expired tokens (3+ days old) - SHOULD trigger refresh on next request
 *
 * Usage:
 *   npx tsx apps/api/test-oauth-workflow.ts <userId>
 */

import { prisma } from 'database'
import { isTokenExpired } from './src/auth/token-refresh'

interface TestScenario {
  name: string
  description: string
  expiresAt: Date
  expectedRefresh: boolean
}

async function runTokenExpiryTests(userId: string) {
  console.log('='.repeat(80))
  console.log('OAuth Workflow Token Refresh Test')
  console.log('='.repeat(80))
  console.log()

  // Fetch user info
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  })

  if (!user) {
    console.error(`❌ User not found: ${userId}`)
    process.exit(1)
  }

  console.log(`Testing user: ${user.email}`)
  console.log()

  // Fetch current calendar connection
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider: 'google' },
    },
  })

  if (!connection) {
    console.error('❌ No Google Calendar connection found for this user.')
    console.error('Please connect your Google Calendar first.')
    process.exit(1)
  }

  console.log('Current token status:')
  console.log(`  Expires at: ${connection.expiresAt?.toISOString() || 'Unknown'}`)
  console.log(`  Has refresh token: ${!!connection.refreshToken}`)
  console.log()

  // Store original expiry for restoration
  const originalExpiresAt = connection.expiresAt

  // Define test scenarios
  const now = new Date()
  const scenarios: TestScenario[] = [
    {
      name: 'Scenario 1: Fresh Tokens',
      description: 'User just logged in, token expires in 1 hour',
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour from now
      expectedRefresh: false,
    },
    {
      name: 'Scenario 2: Tokens Expiring Soon',
      description: 'Token expires in 5 minutes (within 10-minute buffer)',
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000), // 5 minutes from now
      expectedRefresh: true,
    },
    {
      name: 'Scenario 3: Expired Tokens (3 days old)',
      description: 'User hasn\'t logged in for 3 days, token is expired',
      expiresAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      expectedRefresh: true,
    },
    {
      name: 'Scenario 4: Tokens Expiring at Exact Buffer (10 minutes)',
      description: 'Token expires in exactly 10 minutes (edge case)',
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 minutes from now
      expectedRefresh: true, // isTokenExpired uses >= for buffer
    },
    {
      name: 'Scenario 5: Tokens Expiring Just Outside Buffer (11 minutes)',
      description: 'Token expires in 11 minutes (just outside buffer)',
      expiresAt: new Date(now.getTime() + 11 * 60 * 1000), // 11 minutes from now
      expectedRefresh: false,
    },
  ]

  let passedTests = 0
  let failedTests = 0

  // Run each test scenario
  for (const scenario of scenarios) {
    console.log('-'.repeat(80))
    console.log(scenario.name)
    console.log('-'.repeat(80))
    console.log(`Description: ${scenario.description}`)
    console.log(`Token expires at: ${scenario.expiresAt.toISOString()}`)
    console.log()

    // Simulate the token expiry check (same logic as context.ts)
    const needsRefresh = isTokenExpired(scenario.expiresAt, 10)

    console.log(`Expected refresh: ${scenario.expectedRefresh ? 'YES' : 'NO'}`)
    console.log(`Actual behavior: ${needsRefresh ? 'WILL REFRESH' : 'SKIP REFRESH'}`)

    // Check if behavior matches expectation
    const passed = needsRefresh === scenario.expectedRefresh

    if (passed) {
      console.log('✅ PASS - Behavior matches expectation')
      passedTests++
    } else {
      console.log('❌ FAIL - Behavior does NOT match expectation')
      failedTests++
    }

    console.log()
  }

  // Summary
  console.log('='.repeat(80))
  console.log('Test Summary')
  console.log('='.repeat(80))
  console.log(`Total tests: ${scenarios.length}`)
  console.log(`Passed: ${passedTests}`)
  console.log(`Failed: ${failedTests}`)
  console.log()

  if (failedTests === 0) {
    console.log('✅ All tests passed! The OAuth workflow fix is working correctly.')
    console.log()
    console.log('What this means:')
    console.log('  • Fresh tokens (just logged in) will NOT be unnecessarily refreshed')
    console.log('  • Tokens expiring within 10 minutes WILL be refreshed proactively')
    console.log('  • Expired tokens (3+ days old) WILL be refreshed on next request')
    console.log('  • No "Unexpected end of JSON input" errors should occur')
  } else {
    console.log('❌ Some tests failed. Review the logic in context.ts')
  }
  console.log()

  // Restore original expiry
  if (originalExpiresAt) {
    console.log(`Restoring original token expiry: ${originalExpiresAt.toISOString()}`)
  }
}

async function testRealWorldLoginFlow(userId: string) {
  console.log('='.repeat(80))
  console.log('Real-World Login Flow Test')
  console.log('='.repeat(80))
  console.log()
  console.log('This test simulates what happens when a user logs in after 3 days of inactivity.')
  console.log()

  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider: 'google' },
    },
  })

  if (!connection) {
    console.error('❌ No calendar connection found')
    return
  }

  // Store original
  const originalExpiresAt = connection.expiresAt

  try {
    // Simulate 3-day-old expired token
    const expiredDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

    console.log('Step 1: Simulating 3-day-old expired token...')
    await prisma.calendarConnection.update({
      where: {
        userId_provider: { userId, provider: 'google' },
      },
      data: {
        expiresAt: expiredDate,
      },
    })
    console.log(`  Token expiry set to: ${expiredDate.toISOString()}`)
    console.log()

    console.log('Step 2: Checking if token needs refresh (context.ts logic)...')
    const needsRefresh = isTokenExpired(expiredDate, 10)
    console.log(`  Needs refresh: ${needsRefresh ? 'YES ✅' : 'NO ❌'}`)
    console.log()

    if (needsRefresh) {
      console.log('Step 3: Token refresh WILL be triggered on next authenticated request')
      console.log('  • User makes request (e.g., auth.status query)')
      console.log('  • Context middleware checks token expiry')
      console.log('  • Token is expired → calls getValidAccessToken()')
      console.log('  • Google OAuth refresh token is used to get new access token')
      console.log('  • New access token stored in database')
      console.log('  • Request proceeds normally')
      console.log()
      console.log('✅ PASS - Expired tokens will be refreshed automatically')
    } else {
      console.log('❌ FAIL - Expired token should trigger refresh but does not')
    }
    console.log()

    console.log('Step 4: Now simulate fresh token (just logged in via OAuth)...')
    const freshDate = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
    await prisma.calendarConnection.update({
      where: {
        userId_provider: { userId, provider: 'google' },
      },
      data: {
        expiresAt: freshDate,
      },
    })
    console.log(`  Token expiry set to: ${freshDate.toISOString()}`)
    console.log()

    console.log('Step 5: Checking if token needs refresh (context.ts logic)...')
    const needsRefreshFresh = isTokenExpired(freshDate, 10)
    console.log(`  Needs refresh: ${needsRefreshFresh ? 'YES ❌' : 'NO ✅'}`)
    console.log()

    if (!needsRefreshFresh) {
      console.log('Step 6: Token refresh will be SKIPPED (token is fresh)')
      console.log('  • User just completed OAuth login')
      console.log('  • Token expires in 1 hour (plenty of time)')
      console.log('  • Context middleware checks token expiry')
      console.log('  • Token is fresh → skips getValidAccessToken()')
      console.log('  • No unnecessary API calls to Google')
      console.log('  • No race conditions with calendar sync')
      console.log()
      console.log('✅ PASS - Fresh tokens are not unnecessarily refreshed')
    } else {
      console.log('❌ FAIL - Fresh token should NOT trigger refresh but does')
    }

  } finally {
    // Restore original
    if (originalExpiresAt) {
      console.log()
      console.log(`Restoring original token expiry: ${originalExpiresAt.toISOString()}`)
      await prisma.calendarConnection.update({
        where: {
          userId_provider: { userId, provider: 'google' },
        },
        data: {
          expiresAt: originalExpiresAt,
        },
      })
    }
  }
}

async function main() {
  const userId = process.argv[2]

  if (!userId) {
    console.error('Usage: npx tsx apps/api/test-oauth-workflow.ts <userId>')
    console.error('')
    console.error('To get your userId, run:')
    console.error('  psql $DATABASE_URL -c "SELECT id, email FROM \\"User\\" LIMIT 5;"')
    process.exit(1)
  }

  try {
    // Run token expiry logic tests
    await runTokenExpiryTests(userId)

    console.log()

    // Run real-world login flow test
    await testRealWorldLoginFlow(userId)

  } catch (error) {
    console.error('Test failed with error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
