import { prisma } from './packages/database/index.js'

async function cleanupStuckSync() {
  try {
    // Get user ID from command line argument
    const userId = process.argv[2]

    if (!userId) {
      console.error('❌ Error: User ID is required')
      console.log('')
      console.log('Usage: npx tsx cleanup-stuck-sync.ts <userId>')
      console.log('')
      console.log('Example: npx tsx cleanup-stuck-sync.ts cmhl38lcq0000c1pjg9lhseul')
      process.exit(1)
    }

    // Find RM connection
    const connection = await prisma.rMConnection.findUnique({
      where: { userId },
    })

    if (!connection) {
      console.log('❌ No RM connection found')
      process.exit(1)
    }

    // Find stuck RUNNING syncs
    const stuckSyncs = await prisma.rMSyncLog.findMany({
      where: {
        connectionId: connection.id,
        status: 'RUNNING',
      },
    })

    if (stuckSyncs.length === 0) {
      console.log('✅ No stuck syncs found')
    } else {
      console.log(`🔧 Found ${stuckSyncs.length} stuck sync(s)`)

      for (const sync of stuckSyncs) {
        console.log(`   - Sync ${sync.id} started at ${sync.startedAt}`)
      }

      // Update them to FAILED
      await prisma.rMSyncLog.updateMany({
        where: {
          connectionId: connection.id,
          status: 'RUNNING',
        },
        data: {
          status: 'FAILED',
          errorMessage: 'Sync cancelled: stuck in RUNNING state',
          completedAt: new Date(),
        },
      })

      console.log('✅ Cleaned up stuck syncs - you can now sync again')
    }

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error cleaning up stuck sync:', error)
    await prisma.$disconnect()
    process.exit(1)
  }
}

cleanupStuckSync()
