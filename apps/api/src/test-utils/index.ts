/**
 * Test Utilities
 *
 * Centralized exports for all test utilities, fixtures, cleanup functions,
 * and pre-built scenarios.
 *
 * @module test-utils
 *
 * @example
 * ```typescript
 * import {
 *   createTestUser,
 *   createTestProject,
 *   cleanupTestData,
 *   createColdStartScenario,
 * } from '../test-utils'
 * ```
 */

// =============================================================================
// FIXTURES
// =============================================================================

export {
  // Core fixtures
  createTestUser,
  createTestProject,
  createTestEvent,
  createTestRule,
  createTestTimesheetEntry,
  createTestSuggestionLog,

  // Batch creation helpers
  createUserWithCategorizations,
  createEventWithEntry,

  // Types
  type TestUser,
  type CreateEventOptions,
  type CreateRuleOptions,

  // Prisma client (shared instance)
  prisma,
} from './fixtures'

// =============================================================================
// CLEANUP
// =============================================================================

export {
  // Main cleanup functions
  cleanupTestData,
  cleanupAllTestData,
  cleanupInDependencyOrder,

  // Specific resource cleanup
  cleanupProjects,
  cleanupEvents,
  cleanupRules,
  cleanupSuggestionLogs,
  cleanupTimesheetEntries,

  // Disconnect
  disconnectPrisma,
} from './cleanup'

// =============================================================================
// SCENARIOS
// =============================================================================

export {
  // Edge case scenarios
  createColdStartScenario,
  createConflictingRulesScenario,
  createAmbiguousKeywordScenario,
  createAmbiguousWithStrongSignalScenario,
  createArchivedProjectScenario,

  // Complex scenarios
  createComprehensiveScenario,
} from './scenarios'

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

export { default as scenarios } from './scenarios'
