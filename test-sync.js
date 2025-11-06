const { syncUserEvents } = require('./apps/api/dist/services/calendar-sync.js');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSync() {
  try {
    console.log('🔄 Testing calendar sync with timezone support...\n');

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

    console.log(`✅ User: ${user.email}\n`);

    // Get calendar connection to show timezone
    const connection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider: { userId: user.id, provider: 'google' }
      }
    });

    console.log(`⏰ Timezone: ${connection?.timezone || 'UTC'}\n`);

    // Trigger sync
    console.log('📥 Syncing events...\n');
    const result = await syncUserEvents(user.id);

    console.log('\n✅ Sync Complete!');
    console.log(`  Calendars processed: ${result.calendarsProcessed}`);
    console.log(`  Events created: ${result.eventsCreated}`);
    console.log(`  Events updated: ${result.eventsUpdated}\n`);

    // Show events from this week
    console.log('📅 Events from this week:');
    const events = await prisma.calendarEvent.findMany({
      where: {
        userId: user.id,
        isDeleted: false,
        startTime: {
          gte: new Date('2025-11-03T00:00:00Z') // Monday Nov 3
        }
      },
      orderBy: { startTime: 'asc' }
    });

    console.log(`  Total: ${events.length} events\n`);

    // Group by day
    const byDay = {};
    events.forEach(e => {
      const day = new Date(e.startTime).toLocaleDateString('en-AU', { weekday: 'long', month: 'short', day: 'numeric' });
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(e);
    });

    Object.entries(byDay).forEach(([day, dayEvents]) => {
      console.log(`  ${day}:`);
      dayEvents.forEach(e => {
        const start = new Date(e.startTime);
        const end = new Date(e.endTime);
        console.log(`    ${start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}: ${e.title}`);
      });
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testSync();
