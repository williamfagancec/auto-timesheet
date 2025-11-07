import { prisma } from 'database'

async function main() {
  const userId = 'cmhl38lcq0000c1pjg9lhseul'

  console.log('=== ALL Calendar Events (Not Deleted) ===')
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId,
      isDeleted: false,
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

  console.log(`Found ${events.length} total events in database`)

  // Group by day
  const byDay = new Map<string, typeof events>()
  events.forEach((event) => {
    const sydneyTime = event.startTime.toLocaleString('en-US', {
      timeZone: 'Australia/Sydney',
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const day = sydneyTime.split(',')[0] // Get weekday
    if (!byDay.has(day)) {
      byDay.set(day, [])
    }
    byDay.get(day)!.push(event)
  })

  byDay.forEach((dayEvents, day) => {
    console.log(`\n=== ${day} (${dayEvents.length} events) ===`)
    dayEvents.forEach((event) => {
      const sydneyStart = event.startTime.toLocaleString('en-US', {
        timeZone: 'Australia/Sydney',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
      const sydneyEnd = event.endTime.toLocaleString('en-US', {
        timeZone: 'Australia/Sydney',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      })
      console.log(`  ${sydneyStart}-${sydneyEnd}: ${event.title}`)
    })
  })

  await prisma.$disconnect()
}

main()
