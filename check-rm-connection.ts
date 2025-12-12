import { prisma } from './packages/database/index.js'

async function checkRMConnection() {
  try {
    const connections = await prisma.rMConnection.findMany({
      select: {
        id: true,
        userId: true,
        rmUserId: true,
        rmUserEmail: true,
        rmUserName: true,
        createdAt: true,
        projectMappings: {
          select: {
            id: true,
            rmProjectName: true,
            enabled: true,
          },
        },
      },
    })

    if (connections.length === 0) {
      console.log('❌ No RM connections found')
      console.log('\nTo create an RM connection:')
      console.log('1. Go to Settings page (if it exists)')
      console.log('2. Or use the API endpoint: POST /trpc/rm.connection.create')
      console.log('3. You need an RM API token')
    } else {
      console.log(`✅ Found ${connections.length} RM connection(s):`)
      connections.forEach((conn, idx) => {
        console.log(`\n${idx + 1}. Connection ID: ${conn.id}`)
        console.log(`   User ID: ${conn.userId}`)
        console.log(`   RM User: ${conn.rmUserName} (${conn.rmUserEmail})`)
        console.log(`   RM User ID: ${conn.rmUserId}`)
        console.log(`   Created: ${conn.createdAt}`)
        console.log(`   Project Mappings: ${conn.projectMappings.length} total, ${conn.projectMappings.filter(m => m.enabled).length} enabled`)

        if (conn.projectMappings.length > 0) {
          console.log('   Mapped Projects:')
          conn.projectMappings.forEach(m => {
            console.log(`     - ${m.rmProjectName} ${m.enabled ? '✓' : '(disabled)'}`)
          })
        }
      })
    }

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error checking RM connection:', error)
    process.exit(1)
  }
}

checkRMConnection()
