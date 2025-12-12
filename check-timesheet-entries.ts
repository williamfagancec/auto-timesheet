import { prisma } from './packages/database/index.js'
import { startOfWeek, endOfWeek } from 'date-fns'

async function checkTimesheetEntries() {
  try {
    const userId = 'cmhl38lcq0000c1pjg9lhseul' // The user ID from RM connection check

    // Get current week (Monday to Sunday)
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

    console.log(`📅 Checking timesheet entries for week: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]}`)

    const entries = await prisma.timesheetEntry.findMany({
      where: {
        userId,
        date: {
          gte: weekStart,
          lte: weekEnd,
        },
        projectId: {
          not: null,
        },
        isSkipped: false,
      },
      include: {
        project: true,
        rmSyncedEntry: true,
      },
      orderBy: {
        date: 'asc',
      },
    })

    if (entries.length === 0) {
      console.log('❌ No timesheet entries found for this week')
      console.log('\nTo create timesheet entries:')
      console.log('1. Categorize calendar events on the Events page')
      console.log('2. Or manually add entries on the Timesheet Grid page')
    } else {
      console.log(`\n✅ Found ${entries.length} timesheet entries:`)
      entries.forEach((entry, idx) => {
        const hours = (entry.duration / 60).toFixed(2)
        const syncStatus = entry.rmSyncedEntry ? '🔄 Synced' : '🆕 Not synced'
        console.log(`${idx + 1}. ${entry.date.toISOString().split('T')[0]} - ${entry.project?.name || 'No Project'} - ${hours}h ${syncStatus}`)
      })

      const notSynced = entries.filter(e => !e.rmSyncedEntry).length
      const synced = entries.filter(e => e.rmSyncedEntry).length
      console.log(`\n📊 Summary: ${notSynced} new, ${synced} already synced`)
    }

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error checking timesheet entries:', error)
    process.exit(1)
  }
}

checkTimesheetEntries()
