import { prisma } from './packages/database/index.js'

async function forceReconnect() {
  try {
    console.log('Disconnecting Prisma...')
    await prisma.$disconnect()

    console.log('Waiting 2 seconds...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    console.log('Reconnecting Prisma...')
    await prisma.$connect()

    console.log('Testing connection with a simple query...')
    const user = await prisma.user.findFirst()
    console.log('✅ Connection successful!', user ? `Found user: ${user.email}` : 'No users found')

    await prisma.$disconnect()
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

forceReconnect()
