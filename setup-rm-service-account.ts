import { prisma } from './packages/database/index.js'
import { encryptRMToken } from './apps/api/src/auth/rm-encryption.js'
import { rmApi } from './apps/api/src/services/rm-api.js'

async function setupRM() {
  try {
    const userId = 'cmhl38lcq0000c1pjg9lhseul' // William Fagan's user ID

    console.log('🔧 Setting up RM service account...\n')

    // Step 1: Get Raj's API token from user
    const rajToken = process.argv[2]
    if (!rajToken) {
      console.error('❌ Please provide Raj\'s RM API token as an argument')
      console.log('\nUsage: npx tsx setup-rm-service-account.ts YOUR_RM_API_TOKEN')
      console.log('\nGet your token from: https://app.rm.smartsheet.com → Settings → Developer API')
      process.exit(1)
    }

    // Step 2: Verify token and get current user
    console.log('✓ Verifying API token...')
    const currentUser = await rmApi.validateToken(rajToken)
    console.log(`  Token User: ${currentUser.name || `${currentUser.first_name} ${currentUser.last_name}`} (${currentUser.email})`)
    console.log(`  Token User ID: ${currentUser.id}\n`)

    // Step 3: Create RM connection
    console.log('✓ Creating RM connection...')
    const { encrypted, iv, authTag } = encryptRMToken(rajToken)

    await prisma.rMConnection.deleteMany({
      where: { userId },
    })

    const connection = await prisma.rMConnection.create({
      data: {
        userId,
        rmUserId: currentUser.id,
        rmUserName: currentUser.name || `${currentUser.first_name} ${currentUser.last_name}`,
        rmUserEmail: currentUser.email,
        encryptedToken: encrypted,
        tokenIv: iv,
        tokenAuthTag: authTag,
      },
    })
    console.log(`  Connection ID: ${connection.id}\n`)

    // Step 4: Ask for William's RM user ID
    const williamRmUserId = process.argv[3]
    if (!williamRmUserId) {
      console.log('⚠️  Please provide William Fagan\'s RM user ID as the second argument')
      console.log('\nFind your RM user ID:')
      console.log('1. Log in to https://app.rm.smartsheet.com')
      console.log('2. Go to Settings → My Profile')
      console.log('3. Look for your user ID in the URL or profile details')
      console.log('\nThen run:')
      console.log(`npx tsx setup-rm-service-account.ts ${rajToken} WILLIAM_RM_USER_ID`)
      process.exit(1)
    }

    const williamUserId = parseInt(williamRmUserId)
    if (isNaN(williamUserId) || williamUserId <= 0) {
      console.error('❌ Invalid RM user ID. Must be a positive number.')
      process.exit(1)
    }

    // Step 5: Update William's RM user ID
    console.log('✓ Setting William\'s RM user ID...')
    await prisma.user.update({
      where: { id: userId },
      data: { rmUserId: williamUserId },
    })
    console.log(`  William's RM User ID: ${williamUserId}\n`)

    console.log('✅ Setup complete!')
    console.log('\n📝 Summary:')
    console.log(`  - Service Account: ${currentUser.name} (${currentUser.email})`)
    console.log(`  - Service Token User ID: ${currentUser.id}`)
    console.log(`  - William's RM User ID: ${williamUserId}`)
    console.log('\nNext steps:')
    console.log('1. Go to http://localhost:3000/settings')
    console.log('2. Click "Manage Project Mappings" to map your projects')
    console.log('3. Go to Timesheet page and click "Sync to RM"')
    console.log('4. Time entries will be created for William Fagan (RM user ' + williamUserId + ')')

    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

setupRM()
