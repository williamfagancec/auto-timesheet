import { prisma } from 'database'

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    take: 5,
  })
  console.log('Users:', JSON.stringify(users, null, 2))
  await prisma.$disconnect()
}

main()
