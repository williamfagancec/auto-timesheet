import { prisma } from './packages/database/index.js'

async function deleteRMConnection() {
  try {
    // Get user ID from command line argument
    const userId = process.argv[2]

    if (!userId) {
      console.error('❌ Error: User ID is required')
      console.log('')
      console.log('Usage: npx tsx delete-rm-connection.ts <userId>')
      console.log('')
      console.log('Example: npx tsx delete-rm-connection.ts cmhl38lcq0000c1pjg9lhseul')
      process.exit(1)
    }

    const connection = await prisma.rMConnection.findUnique({
      where: { userId },
    })

    if (!connection) {
      console.log('❌ No RM connection found')
      process.exit(0)
    }

    console.log(`🗑️  Deleting RM connection for user: ${userId}`)
    console.log(`   Connection ID: ${connection.id}`)
    console.log(`   RM User: ${connection.rmUserName} (${connection.rmUserEmail})`)

    // Delete the connection (cascades to mappings, synced entries, and logs)
    await prisma.rMConnection.delete({
      where: { id: connection.id },
    })

    console.log('✅ RM connection deleted successfully!')
    console.log('')
    console.log('Next steps:')
    console.log('1. Get your RM API token from https://app.rm.smartsheet.com')
    console.log('   → Settings → API & Integrations → Personal Access Tokens')
    console.log('2. Go to your time-tracker Settings page')
    console.log('3. Connect with your token to re-establish the RM connection')

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error deleting RM connection:', error)
    process.exit(1)
  }
}

deleteRMConnection()
