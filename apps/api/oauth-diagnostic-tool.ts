#!/usr/bin/env tsx
/**
 * OAuth Diagnostic Tool
 *
 * This script helps diagnose OAuth token issues by checking:
 * - Environment variables configuration
 * - Database connections
 * - Token encryption/decryption
 * - User calendar connections
 * - Token expiry status
 *
 * Usage: npx tsx oauth-diagnostic-tool.ts [userId]
 */

import { prisma } from 'database'
import { decrypt } from './src/auth/encryption.js'
import { isTokenExpired } from './src/auth/token-refresh.js'

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'SESSION_SECRET',
]

interface DiagnosticResult {
  passed: boolean
  message: string
  details?: any
}

async function checkEnvironmentVariables(): Promise<DiagnosticResult> {
  console.log('\n🔍 Checking environment variables...')

  const missing = REQUIRED_ENV_VARS.filter(varName => !process.env[varName])

  if (missing.length > 0) {
    return {
      passed: false,
      message: `Missing required environment variables: ${missing.join(', ')}`,
    }
  }

  // Check encryption key format
  const encryptionKey = process.env.ENCRYPTION_KEY!
  if (encryptionKey.length !== 64) {
    return {
      passed: false,
      message: `ENCRYPTION_KEY must be 64 hex characters, got ${encryptionKey.length}`,
    }
  }

  console.log('✅ All required environment variables present')
  return {
    passed: true,
    message: 'All environment variables configured correctly',
  }
}

async function checkDatabaseConnection(): Promise<DiagnosticResult> {
  console.log('\n🔍 Checking database connection...')

  try {
    await prisma.$connect()
    await prisma.$queryRaw`SELECT 1`
    console.log('✅ Database connection successful')
    return {
      passed: true,
      message: 'Database connection working',
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    return {
      passed: false,
      message: 'Failed to connect to database',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function checkUserCalendarConnections(userId?: string): Promise<DiagnosticResult> {
  console.log('\n🔍 Checking user calendar connections...')

  try {
    const whereClause = userId ? { userId } : {}
    const connections = await prisma.calendarConnection.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    })

    if (connections.length === 0) {
      console.log('⚠️  No calendar connections found')
      return {
        passed: true,
        message: userId
          ? `No calendar connection found for user ${userId}`
          : 'No calendar connections in database',
      }
    }

    console.log(`Found ${connections.length} calendar connection(s):\n`)

    for (const conn of connections) {
      console.log(`  User: ${conn.user.email} (${conn.userId})`)
      console.log(`  Provider: ${conn.provider}`)
      console.log(`  Has access token: ${conn.accessToken ? 'Yes' : 'No'}`)
      console.log(`  Has refresh token: ${conn.refreshToken ? 'Yes' : 'No'}`)
      console.log(`  Token expires: ${conn.expiresAt?.toISOString() || 'Unknown'}`)

      // Check if token is expired
      if (conn.expiresAt) {
        const expired = isTokenExpired(conn.expiresAt)
        console.log(`  Token expired: ${expired ? 'Yes ⚠️' : 'No ✅'}`)
      }

      // Try to decrypt tokens
      try {
        const decryptedAccess = decrypt(conn.accessToken)
        console.log(`  Access token decryption: ✅ Success (length: ${decryptedAccess.length})`)
      } catch (error) {
        console.log(`  Access token decryption: ❌ Failed`)
        console.error(`    Error: ${error instanceof Error ? error.message : String(error)}`)
      }

      if (conn.refreshToken) {
        try {
          const decryptedRefresh = decrypt(conn.refreshToken)
          console.log(`  Refresh token decryption: ✅ Success (length: ${decryptedRefresh.length})`)
        } catch (error) {
          console.log(`  Refresh token decryption: ❌ Failed`)
          console.error(`    Error: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      console.log(`  Selected calendars: ${conn.selectedCalendarIds ? JSON.stringify(conn.selectedCalendarIds) : 'None'}`)
      console.log()
    }

    return {
      passed: true,
      message: `Found ${connections.length} calendar connection(s)`,
    }
  } catch (error) {
    console.error('❌ Failed to check calendar connections:', error)
    return {
      passed: false,
      message: 'Failed to query calendar connections',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function checkGoogleOAuthConfig(): Promise<DiagnosticResult> {
  console.log('\n🔍 Checking Google OAuth configuration...')

  const clientId = process.env.GOOGLE_CLIENT_ID!
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!

  console.log(`  Client ID: ${clientId}`)
  console.log(`  Redirect URI: ${redirectUri}`)

  // Basic validation
  if (!clientId.endsWith('.apps.googleusercontent.com')) {
    return {
      passed: false,
      message: 'GOOGLE_CLIENT_ID format looks invalid (should end with .apps.googleusercontent.com)',
    }
  }

  console.log('✅ Google OAuth configuration looks valid')
  return {
    passed: true,
    message: 'Google OAuth configuration valid',
  }
}

async function runDiagnostics(userId?: string) {
  console.log('====================================')
  console.log('🔧 OAuth Diagnostic Tool')
  console.log('====================================')

  const results: DiagnosticResult[] = []

  // Run all checks
  results.push(await checkEnvironmentVariables())
  results.push(await checkDatabaseConnection())
  results.push(await checkGoogleOAuthConfig())
  results.push(await checkUserCalendarConnections(userId))

  // Summary
  console.log('\n====================================')
  console.log('📊 DIAGNOSTIC SUMMARY')
  console.log('====================================\n')

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  results.forEach((result, index) => {
    const icon = result.passed ? '✅' : '❌'
    console.log(`${icon} ${result.message}`)
    if (result.details) {
      console.log(`   Details: ${result.details}`)
    }
  })

  console.log(`\nTotal: ${passed} passed, ${failed} failed\n`)

  if (failed > 0) {
    console.log('⚠️  Some checks failed. Please address the issues above.')
    process.exit(1)
  } else {
    console.log('✅ All diagnostic checks passed!')
    process.exit(0)
  }
}

// Parse command line arguments
const userId = process.argv[2]

runDiagnostics(userId)
  .catch((error) => {
    console.error('\n❌ Diagnostic tool crashed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
