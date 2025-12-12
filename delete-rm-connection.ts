import { prisma } from './packages/database/index.js'

async function deleteRMConnection() {
  try {
    const userId = 'cmhl38lcq0000c1pjg9lhseul' // William Fagan's user ID

    const connection = await prisma.rMConnection.findUnique({
      where: { userId },
    })

    if (!connection) {
      console.log('❌ No RM connection found')
      process.exit(0)
    }

    console.log('🗑️  Deleting RM connection for Raj Mendes...')
    console.log(`   Connection ID: ${connection.id}`)
    console.log(`   RM User: ${connection.rmUserName} (${connection.rmUserEmail})`)

    // Delete the connection (cascades to mappings, synced entries, and logs)
    await prisma.rMConnection.delete({
      where: { id: connection.id },
    })

    console.log('✅ RM connection deleted successfully!')
    console.log('')
    console.log('Next steps:')
    console.log('1. Get YOUR RM API token from https://app.rm.smartsheet.com')
    console.log('   → Settings → API & Integrations → Personal Access Tokens')
    console.log('2. Go to your time-tracker Settings page')
    console.log('3. Connect with YOUR token to sync entries under William Fagan')

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error deleting RM connection:', error)
    process.exit(1)
  }
}

deleteRMConnection()
