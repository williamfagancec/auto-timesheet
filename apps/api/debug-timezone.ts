/**
 * Diagnostic script to debug timezone sync issues
 *
 * Usage: npx tsx apps/api/debug-timezone.ts [userId]
 */

import { prisma } from 'database'
import { getUserLocalNow, getStartOfCurrentWeek } from './src/services/calendar-sync.js'

const userId = process.argv[2]

if (!userId) {
  console.error('Usage: npx tsx apps/api/debug-timezone.ts [userId]')
  process.exit(1)
}

async function main() {
  console.log('\n=== TIMEZONE SYNC DIAGNOSTIC ===\n')

  // 1. Get user's calendar connection
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider: 'google' },
    },
  })

  if (!connection) {
    console.error('❌ No calendar connection found for user')
    process.exit(1)
  }

  console.log('✅ Calendar Connection Found')
  console.log(`   User ID: ${userId}`)
  console.log(`   Timezone: ${connection.timezone || 'UTC'}`)
  console.log(`   Selected Calendars: ${JSON.stringify(connection.selectedCalendarIds)}`)
  console.log()

  // 2. Show timezone calculations
  const timezone = connection.timezone || 'UTC'
  const utcNow = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const localParts = formatter.formatToParts(utcNow)
  const offsetLabel = localParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00'
  const offsetMatch = offsetLabel.match(/GMT([+-]\d{2})(?::?(\d{2}))?/)
  const offsetSign = offsetLabel.startsWith('GMT-') ? -1 : 1
  const offsetHours = Number(offsetMatch?.[1]?.slice(1) ?? '0') 
  const offsetMinutes = Number(offsetMatch?.[2] ?? '0')
  const totalOffsetMinutes = offsetSign * (offsetHours * 60 + offsetMinutes)
  const userLocalNow = newDate(utcNow.getTime() + totalOffsetMinutes * 60 * 1000)
  const weekStart = getStartOfCurrentWeek()

  console.log('⏰ Time Calculations:')
  console.log(`   Current UTC time:        ${utcNow.toISOString()} (${utcNow.getTime()})`)
  console.log(`   User's local "now":      ${userLocalNow.toISOString()} (${userLocalNow.getTime()})`)
  console.log(`   Start of week (Monday):  ${weekStart.toISOString()}`)
  console.log()

  // 3. Show what timeMax will be used in sync
  console.log('🔍 Sync Window:')
  console.log(`   timeMin: ${weekStart.toISOString()}`)
  console.log(`   timeMax: ${userLocalNow.toISOString()}`)
  console.log()

  // 4. Timezone configuration status
  console.log('⚙️  Timezone Configuration:')
  if (!connection.timezone || connection.timezone === 'UTC') {
    console.log('   ⚠️  WARNING: Timezone is not set or defaulting to UTC')
    console.log('   This means calendar sync will miss events for users outside UTC timezone.')
    console.log('   Fix: Log out and log back in with Google OAuth to auto-detect timezone')
  } else {
    console.log(`   ✅ Timezone is set to: ${connection.timezone}`)
  }
  console.log()

  // 5. Get recent events to show filtering
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      isDeleted: false,
    },
    orderBy: {
      startTime: 'desc',
    },
    take: 10,
  })

  console.log(`📅 Recent Events (${events.length} shown):`)
  for (const event of events) {
    const endTime = event.endTime
    const isPastUTC = endTime < utcNow
    const isPastUserLocal = endTime < userLocalNow

    console.log(`   ${event.title}`)
    console.log(`      Start: ${event.startTime.toISOString()}`)
    console.log(`      End:   ${endTime.toISOString()}`)
    console.log(`      Past (UTC):        ${isPastUTC ? '✅' : '❌'}`)
    console.log(`      Past (User Local): ${isPastUserLocal ? '✅' : '❌'}`)

    if (isPastUTC !== isPastUserLocal) {
      console.log(`      ⚠️  MISMATCH: Event appears ${isPastUserLocal ? 'past' : 'future'} in user's timezone but ${isPastUTC ? 'past' : 'future'} in UTC`)
    }
    console.log()
  }

  // 6. Show what would be filtered
  console.log('🔍 Filtering Analysis:')
  const pastInUTC = events.filter(e => e.endTime < utcNow)
  const pastInUserLocal = events.filter(e => e.endTime < userLocalNow)

  console.log(`   Events ending before UTC now:        ${pastInUTC.length}`)
  console.log(`   Events ending before user local now: ${pastInUserLocal.length}`)

  if (pastInUTC.length !== pastInUserLocal.length) {
    console.log(`   ⚠️  ${Math.abs(pastInUTC.length - pastInUserLocal.length)} events show different past/future status between UTC and user timezone`)
    console.log(`   This is expected for users in non-UTC timezones!`)
  } else {
    console.log(`   ✅ No discrepancy (user may be in UTC timezone or no events span the boundary)`)
  }

  console.log('\n=== NEXT STEPS ===\n')

  if (!connection.timezone || connection.timezone === 'UTC') {
    console.log('1. ⚠️  Set your timezone by logging out and back in with Google OAuth')
    console.log('   Or manually update the database:')
    console.log(`   UPDATE "CalendarConnection" SET timezone='Australia/Sydney' WHERE "userId"='${userId}';`)
    console.log()
  }

  console.log('2. Restart the API server to ensure latest code is running:')
  console.log('   pnpm dev:api')
  console.log()

  console.log('3. Trigger a manual calendar sync via the frontend:')
  console.log('   - Go to http://localhost:3000/events')
  console.log('   - Click "Sync Now" button')
  console.log()

  console.log('4. Verify Thursday afternoon events now appear')
  console.log()

  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
