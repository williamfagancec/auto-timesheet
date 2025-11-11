/**
 * Test Cleanup Utilities
 *
 * Helper functions for cleaning up test data in the correct order to respect
 * foreign key constraints.
 *
 * @module test-utils/cleanup
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Delete all test data for a specific user.
 *
 * Deletes data in the correct order to respect foreign key constraints:
 * 1. SuggestionLog (references Event + Project)
 * 2. TimesheetEntry (references Event + Project)
 * 3. CategoryRule (references Project)
 * 4. CalendarEvent (references User)
 * 5. Project (references User)
 * 6. CalendarConnection (references User)
 * 7. Session (references User)
 * 8. User
 *
 * @param userId - User ID to clean up
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *   await cleanupTestData(testUser.id)
 * })
 * ```
 */
export async function cleanupTestData(userId: string): Promise<void> {
  try {
    // Step 1: Delete SuggestionLog (references Event + Project)
    await prisma.suggestionLog.deleteMany({
      where: { userId },
    })

    // Step 2: Delete TimesheetEntry (references Event + Project)
    await prisma.timesheetEntry.deleteMany({
      where: { userId },
    })

    // Step 3: Delete CategoryRule (references Project)
    await prisma.categoryRule.deleteMany({
      where: { userId },
    })

    // Step 4: Delete CalendarEvent (references User)
    await prisma.calendarEvent.deleteMany({
      where: { userId },
    })

    // Step 5: Delete Project (references User)
    await prisma.project.deleteMany({
      where: { userId },
    })

    // Step 6: Delete CalendarConnection (references User)
    await prisma.calendarConnection.deleteMany({
      where: { userId },
    })

    // Step 7: Delete Session (references User)
    await prisma.session.deleteMany({
      where: { userId },
    })

    // Step 8: Delete User
    await prisma.user.deleteMany({
      where: { id: userId },
    })
    
  } catch (error) {
    console.error('[Test Cleanup] Error cleaning up test data:', error, { userId })
    throw error
  }
}

/**
 * Delete all test data in the database.
 *
 * **WARNING:** This will delete ALL data in the database!
 * Only use this in test environments with a dedicated test database.
 *
 * Deletes data in the correct order to respect foreign key constraints.
 *
 * @example
 * ```typescript
 * // In test setup
 * beforeAll(async () => {
 *   await cleanupAllTestData() // Start with clean slate
 * })
 * ```
 */
export async function cleanupAllTestData(): Promise<void> {
  try {
    // Verify we're in test environment
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'cleanupAllTestData can only be run in test environment (NODE_ENV=test)'
      )
    }

    console.log('[Test Cleanup] Cleaning up all test data...')

    // Delete in dependency order
    await prisma.suggestionLog.deleteMany({})
    await prisma.timesheetEntry.deleteMany({})
    await prisma.categoryRule.deleteMany({})
    await prisma.calendarEvent.deleteMany({})
    await prisma.project.deleteMany({})
    await prisma.calendarConnection.deleteMany({})
    await prisma.session.deleteMany({})
    await prisma.user.deleteMany({})

    console.log('[Test Cleanup] All test data cleaned up successfully')
  } catch (error) {
    console.error('[Test Cleanup] Error cleaning up all test data:', error)
    throw error
  }
}

/**
 * Delete data in the correct dependency order.
 *
 * This is a generic cleanup function that can be customized with where clauses
 * for each table.
 *
 * @param whereClause - Optional where clause to apply to all deletions
 *
 * @example
 * ```typescript
 * // Delete all data created in the last hour
 * await cleanupInDependencyOrder({
 *   createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
 * })
 * ```
 */
export async function cleanupInDependencyOrder(whereClause?: any): Promise<void> {
  try {
    await prisma.suggestionLog.deleteMany({ where: whereClause })
    await prisma.timesheetEntry.deleteMany({ where: whereClause })
    await prisma.categoryRule.deleteMany({ where: whereClause })
    await prisma.calendarEvent.deleteMany({ where: whereClause })
    await prisma.project.deleteMany({ where: whereClause })
    await prisma.calendarConnection.deleteMany({ where: whereClause })
    await prisma.session.deleteMany({ where: whereClause })
    // Note: User deletion might fail if whereClause doesn't match all users
    // that have dependent data, so we skip it here
  } catch (error) {
    console.error('[Test Cleanup] Error in dependency order cleanup:', error)
    throw error
  }
}

/**
 * Cleanup specific resources by type.
 *
 * Useful when you only need to clean up certain types of test data.
 *
 * @example
 * ```typescript
 * // Clean up only rules and suggestions
 * await cleanupRules(userId)
 * await cleanupSuggestionLogs(userId)
 * ```
 */

export async function cleanupProjects(userId: string): Promise<void> {
  // First delete dependent data
  await prisma.timesheetEntry.deleteMany({ where: { userId } })
  await prisma.categoryRule.deleteMany({ where: { userId } })
  await prisma.suggestionLog.deleteMany({ where: { userId } })
  // Then delete projects
  await prisma.project.deleteMany({ where: { userId } })
}

export async function cleanupEvents(userId: string): Promise<void> {
  // First delete dependent data
  await prisma.timesheetEntry.deleteMany({ where: { userId } })
  await prisma.suggestionLog.deleteMany({ where: { userId } })
  // Then delete events
  await prisma.calendarEvent.deleteMany({ where: { userId } })
}

export async function cleanupRules(userId: string): Promise<void> {
  await prisma.categoryRule.deleteMany({ where: { userId } })
}

export async function cleanupSuggestionLogs(userId: string): Promise<void> {
  await prisma.suggestionLog.deleteMany({ where: { userId } })
}

export async function cleanupTimesheetEntries(userId: string): Promise<void> {
  await prisma.timesheetEntry.deleteMany({ where: { userId } })
}

// =============================================================================
// DISCONNECT
// =============================================================================

/**
 * Disconnect Prisma client.
 *
 * Should be called in afterAll hook to properly close database connections.
 *
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await disconnectPrisma()
 * })
 * ```
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}

// =============================================================================
// EXPORTS
// =============================================================================

export { prisma }
