import { prisma } from 'database'

async function main() {
  const userId = 'cmhl38lcq0000c1pjg9lhseul' // william.fagan@customerexperience.com.au

  console.log('=== Calendar Connection ===')
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider: 'google' },
    },
  })

  if (connection) {
    console.log('Timezone:', connection.timezone)
    console.log('Selected Calendars:', connection.selectedCalendarIds)
    console.log('Token expires:', connection.expiresAt)
  } else {
    console.log('No connection found')
  }

  console.log('\n=== Calendar Events ===')
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      isDeleted: false,
      startTime: {
        gte: new Date('2025-11-06T00:00:00Z'), // Thursday in UTC
        lt: new Date('2025-11-07T00:00:00Z'),
      },
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      endTime: true,
      isAllDay: true,
      calendarId: true,
    },
    orderBy: { startTime: 'asc' },
  })

  console.log(`Found ${events.length} Thursday events in database:`)
  events.forEach((event) => {
    console.log(`  - ${event.title}`)
    console.log(`    Start: ${event.startTime.toISOString()}`)
    console.log(`    End: ${event.endTime.toISOString()}`)
    console.log(`    Calendar: ${event.calendarId}`)
    console.log('')
  })

  await prisma.$disconnect()
}

main()
