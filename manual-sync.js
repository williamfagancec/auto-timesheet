const { PrismaClient } = require('database');
const { syncUserCalendar } = require('./apps/api/dist/services/calendar-sync.js');

const prisma = new PrismaClient();

async function manualSync() {
  try {
    console.log('🔄 Starting manual calendar sync...\n');

    // Get the user
    const user = await prisma.user.findFirst({
      where: {
        email: 'william.fagan@customerexperience.com.au'
      }
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`✅ Found user: ${user.email} (${user.id})\n`);

    // Get calendar connection
    const connection = await prisma.calendarConnection.findUnique({
      where: { userId: user.id }
    });

    if (!connection) {
      console.log('❌ No calendar connection found');
      return;
    }

    console.log(`✅ Calendar connected with ${connection.selectedCalendarIds.length} calendars\n`);

    // Trigger sync
    console.log('🔄 Syncing calendar events...\n');
    const result = await syncUserCalendar(user.id);

    console.log('\n📊 Sync Results:');
    console.log(`  Events fetched: ${result.eventsFetched}`);
    console.log(`  Events created: ${result.eventsCreated}`);
    console.log(`  Events updated: ${result.eventsUpdated}`);
    console.log(`  Events deleted: ${result.eventsDeleted}`);

    // Show recent events
    console.log('\n📅 Recent events in database:');
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        isDeleted: false
      },
      orderBy: { startTime: 'desc' },
      take: 10
    });

    events.forEach(e => {
      const start = new Date(e.startTime);
      const end = new Date(e.endTime);
      console.log(`  - [${start.toLocaleDateString()}] ${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}: ${e.title}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

manualSync();
