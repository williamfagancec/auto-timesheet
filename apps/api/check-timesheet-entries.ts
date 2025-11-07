import { prisma } from 'database'

async function main() {
  const userId = 'cmhl38lcq0000c1pjg9lhseul'

  console.log('=== Timesheet Entries Analysis ===')

  // Get all calendar events
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      isDeleted: false,
    },
    select: {
      id: true,
      title: true,
      startTime: true,
    },
  })

  console.log(`Total CalendarEvents: ${events.length}`)

  // Get all timesheet entries
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      userId,
    },
    include: {
      event: true,
      project: true,
    },
  })

  console.log(`Total TimesheetEntries: ${entries.length}`)

  // Count by category
  const categorized = entries.filter((e) => e.projectId !== null && !e.isSkipped)
  const skipped = entries.filter((e) => e.isSkipped)
  const uncategorized = entries.filter((e) => e.projectId === null && !e.isSkipped)

  console.log(`  - Categorized: ${categorized.length}`)
  console.log(`  - Skipped: ${skipped.length}`)
  console.log(`  - Uncategorized: ${uncategorized.length}`)

  // Count events WITH timesheet entries
  const eventsWithEntries = events.filter((event) =>
    entries.some((entry) => entry.eventId === event.id)
  )

  console.log(`\nCalendar Events WITH TimesheetEntry: ${eventsWithEntries.length}`)
  console.log(`Calendar Events WITHOUT TimesheetEntry: ${events.length - eventsWithEntries.length}`)

  console.log('\n=== Events Without Timesheet Entries ===')
  const eventsWithoutEntries = events.filter(
    (event) => !entries.some((entry) => entry.eventId === event.id)
  )

  eventsWithoutEntries.forEach((event) => {
    const sydneyTime = event.startTime.toLocaleString('en-US', {
      timeZone: 'Australia/Sydney',
      weekday: 'short',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    console.log(`  - ${sydneyTime}: ${event.title}`)
  })

  console.log('\n=== Thursday Events ===')
  const thursdayEvents = events.filter((event) => {
    const utcDate = event.startTime.toISOString()
    return utcDate.startsWith('2025-11-06')
  })

  console.log(`Thursday CalendarEvents in DB: ${thursdayEvents.length}`)

  const thursdayEntries = entries.filter((entry) => {
    if (!entry.event) return false
    const utcDate = entry.event.startTime.toISOString()
    return utcDate.startsWith('2025-11-06')
  })

  console.log(`Thursday TimesheetEntries: ${thursdayEntries.length}`)

  if (thursdayEntries.length > 0) {
    console.log('\nThursday Timesheet Entries:')
    thursdayEntries.forEach((entry) => {
      const status = entry.isSkipped
        ? 'SKIPPED'
        : entry.projectId
          ? `PROJECT: ${entry.project?.name}`
          : 'UNCATEGORIZED'
      console.log(`  - ${entry.event?.title} [${status}]`)
    })
  }

  await prisma.$disconnect()
}

main()
