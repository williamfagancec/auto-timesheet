/**
 * Test Fixtures
 *
 * Helper functions for creating test data in integration tests.
 * All functions interact with a real database and should be used with proper cleanup.
 *
 * @module test-utils/fixtures
 */

import { PrismaClient, User, Project, CalendarEvent, CategoryRule, TimesheetEntry, SuggestionLog } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { CategoryRuleType } from 'shared'

const prisma = new PrismaClient()

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface TestUser {
  id: string
  email: string
}

export interface CreateEventOptions {
  googleEventId?: string | null
  calendarId?: string
  attendees?: Array<{ email: string; responseStatus?: string }>
  startTime?: Date
  endTime?: Date
  isDeleted?: boolean
}

export interface CreateRuleOptions {
  confidenceScore?: number
  accuracy?: number
  matchCount?: number
  totalSuggestions?: number
  lastMatchedAt?: Date | null
}

// =============================================================================
// USER FIXTURES
// =============================================================================

/**
 * Create a test user with unique email.
 *
 * @param email - Optional custom email (will be made unique with timestamp)
 * @param password - Optional password (defaults to 'password123')
 * @returns Created user object
 *
 * @example
 * ```typescript
 * const user = await createTestUser('test@example.com')
 * // Returns: { id: '...', email: 'test-1234567890@example.com' }
 * ```
 */
export async function createTestUser(
  email: string = 'test@example.com',
  password: string = 'password123'
): Promise<TestUser> {
  // Make email unique with timestamp
  const timestamp = Date.now()
  const [localPart, domain] = email.split('@')
  const uniqueEmail = `${localPart}-${timestamp}@${domain}`

  const hashedPassword = await hash(password)

  const user = await prisma.user.create({
    data: {
      email: uniqueEmail,
      hashedPassword,
    },
    select: {
      id: true,
      email: true,
    },
  })

  return user
}

// =============================================================================
// PROJECT FIXTURES
// =============================================================================

/**
 * Create a test project.
 *
 * @param userId - User ID who owns the project
 * @param name - Project name
 * @param isArchived - Whether project is archived (default: false)
 * @returns Created project object
 *
 * @example
 * ```typescript
 * const project = await createTestProject(user.id, 'Engineering')
 * const archivedProject = await createTestProject(user.id, 'Old Project', true)
 * ```
 */
export async function createTestProject(
  userId: string,
  name: string,
  isArchived: boolean = false
): Promise<Project> {
  return await prisma.project.create({
    data: {
      userId,
      name,
      isArchived,
      useCount: 0,
    },
  })
}

// =============================================================================
// CALENDAR EVENT FIXTURES
// =============================================================================

/**
 * Create a test calendar event.
 *
 * @param userId - User ID who owns the event
 * @param title - Event title
 * @param options - Optional event properties
 * @returns Created calendar event object
 *
 * @example
 * ```typescript
 * const event = await createTestEvent(user.id, 'Engineering Standup', {
 *   attendees: [{ email: 'team@acme.com' }],
 *   googleEventId: 'recurring_123',
 *   calendarId: 'primary',
 * })
 * ```
 */
export async function createTestEvent(
  userId: string,
  title: string,
  options: CreateEventOptions = {}
): Promise<CalendarEvent> {
  const timestamp = Date.now()
  const defaultGoogleEventId = `test-event-${timestamp}`
  const defaultStartTime = new Date()
  const defaultEndTime = new Date(defaultStartTime.getTime() + 60 * 60 * 1000) // +1 hour

  return await prisma.calendarEvent.create({
    data: {
      userId,
      googleEventId: options.googleEventId === undefined ? defaultGoogleEventId : options.googleEventId,
      calendarId: options.calendarId || 'primary',
      title,
      startTime: options.startTime || defaultStartTime,
      endTime: options.endTime || defaultEndTime,
      attendees: options.attendees || [],
      isDeleted: options.isDeleted || false,
      splitIndex: 0,
    },
  })
}

// =============================================================================
// CATEGORY RULE FIXTURES
// =============================================================================

/**
 * Create a test category rule.
 *
 * @param userId - User ID who owns the rule
 * @param projectId - Project ID the rule points to
 * @param ruleType - Type of rule (TITLE_KEYWORD, ATTENDEE_EMAIL, etc.)
 * @param condition - Rule condition (keyword, email, etc.)
 * @param options - Optional rule properties (confidence, accuracy, etc.)
 * @returns Created category rule object
 *
 * @example
 * ```typescript
 * const rule = await createTestRule(
 *   user.id,
 *   project.id,
 *   'TITLE_KEYWORD',
 *   'standup',
 *   { confidenceScore: 0.8, accuracy: 0.9 }
 * )
 * ```
 */
export async function createTestRule(
  userId: string,
  projectId: string,
  ruleType: CategoryRuleType,
  condition: string,
  options: CreateRuleOptions = {}
): Promise<CategoryRule> {
  return await prisma.categoryRule.create({
    data: {
      userId,
      projectId,
      ruleType,
      condition,
      confidenceScore: options.confidenceScore ?? 0.7,
      accuracy: options.accuracy ?? 0.5,
      matchCount: options.matchCount ?? 10,
      totalSuggestions: options.totalSuggestions ?? 20,
      lastMatchedAt: options.lastMatchedAt === undefined ? null : options.lastMatchedAt,
    },
  })
}

// =============================================================================
// TIMESHEET ENTRY FIXTURES
// =============================================================================

/**
 * Create a test timesheet entry.
 *
 * @param userId - User ID who owns the entry
 * @param projectId - Project ID for the entry
 * @param eventId - Optional calendar event ID
 * @param date - Date of the entry (default: today)
 * @param duration - Duration in hours (default: 1.0)
 * @returns Created timesheet entry object
 *
 * @example
 * ```typescript
 * const entry = await createTestTimesheetEntry(
 *   user.id,
 *   project.id,
 *   event.id,
 *   new Date(),
 *   8.0
 * )
 * ```
 */
export async function createTestTimesheetEntry(
  userId: string,
  projectId: string,
  eventId?: string,
  date: Date = new Date(),
  duration: number = 1.0
): Promise<TimesheetEntry> {
  return await prisma.timesheetEntry.create({
    data: {
      userId,
      projectId,
      eventId: eventId || null,
      date,
      duration,
    },
  })
}

// =============================================================================
// SUGGESTION LOG FIXTURES
// =============================================================================

/**
 * Create a test suggestion log.
 *
 * @param userId - User ID
 * @param eventId - Calendar event ID
 * @param suggestedProjectId - Project ID that was suggested
 * @param confidence - Confidence score (0.0-1.0)
 * @param outcome - Outcome: 'ACCEPTED', 'REJECTED', or 'IGNORED'
 * @returns Created suggestion log object
 *
 * @example
 * ```typescript
 * const log = await createTestSuggestionLog(
 *   user.id,
 *   event.id,
 *   project.id,
 *   0.85,
 *   'ACCEPTED'
 * )
 * ```
 */
export async function createTestSuggestionLog(
  userId: string,
  eventId: string,
  suggestedProjectId: string,
  confidence: number,
  outcome: 'ACCEPTED' | 'REJECTED' | 'IGNORED'
): Promise<SuggestionLog> {
  return await prisma.suggestionLog.create({
    data: {
      userId,
      eventId,
      suggestedProjectId,
      confidence,
      outcome,
    },
  })
}

// =============================================================================
// BATCH CREATION HELPERS
// =============================================================================

/**
 * Create a test user with multiple categorizations (for cold start testing).
 *
 * @param categorizationCount - Number of timesheet entries to create
 * @returns Object with user, projects, events, and entries
 *
 * @example
 * ```typescript
 * const { user, entries } = await createUserWithCategorizations(5)
 * // User will have 5 categorized events (passes cold start threshold)
 * ```
 */
export async function createUserWithCategorizations(
  categorizationCount: number
): Promise<{
  user: TestUser
  projects: Project[]
  events: CalendarEvent[]
  entries: TimesheetEntry[]
}> {
  const user = await createTestUser()
  const projects: Project[] = []
  const events: CalendarEvent[] = []
  const entries: TimesheetEntry[] = []

  // Create one project per categorization (varied data)
  for (let i = 0; i < categorizationCount; i++) {
    const project = await createTestProject(user.id, `Project ${i + 1}`)
    const event = await createTestEvent(user.id, `Event ${i + 1}`)
    const entry = await createTestTimesheetEntry(user.id, project.id, event.id)

    projects.push(project)
    events.push(event)
    entries.push(entry)
  }

  return { user, projects, events, entries }
}

/**
 * Create test event with a timesheet entry already categorized.
 *
 * @param userId - User ID
 * @param projectId - Project ID
 * @param title - Event title
 * @returns Object with event and entry
 *
 * @example
 * ```typescript
 * const { event, entry } = await createEventWithEntry(user.id, project.id, 'Team Standup')
 * ```
 */
export async function createEventWithEntry(
  userId: string,
  projectId: string,
  title: string
): Promise<{ event: CalendarEvent; entry: TimesheetEntry }> {
  const event = await createTestEvent(userId, title)
  const entry = await createTestTimesheetEntry(userId, projectId, event.id)

  return { event, entry }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { prisma }
