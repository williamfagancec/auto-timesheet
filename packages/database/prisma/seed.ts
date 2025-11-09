/**
 * Database Seed Script
 *
 * Creates sample data for testing the AI Suggestion Engine.
 *
 * Run with: npx prisma db seed
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seed...')

  // Create a test user
  const testUser = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      name: 'Test User',
      hashedPassword: null, // OAuth-only user
    },
  })
  console.log('✅ Created test user:', testUser.email)

  // Create sample projects
  const internalProject = await prisma.project.upsert({
    where: { id: 'seed-internal-project' },
    update: {},
    create: {
      id: 'seed-internal-project',
      userId: testUser.id,
      name: 'Internal',
      useCount: 15,
      lastUsedAt: new Date(),
    },
  })

  const acmeClientProject = await prisma.project.upsert({
    where: { id: 'seed-acme-project' },
    update: {},
    create: {
      id: 'seed-acme-project',
      userId: testUser.id,
      name: 'Acme Corp Client',
      useCount: 8,
      lastUsedAt: new Date(),
    },
  })

  const globexClientProject = await prisma.project.upsert({
    where: { id: 'seed-globex-project' },
    update: {},
    create: {
      id: 'seed-globex-project',
      userId: testUser.id,
      name: 'Globex Industries',
      useCount: 5,
      lastUsedAt: new Date(),
    },
  })

  const engineeringProject = await prisma.project.upsert({
    where: { id: 'seed-engineering-project' },
    update: {},
    create: {
      id: 'seed-engineering-project',
      userId: testUser.id,
      name: 'Engineering',
      useCount: 20,
      lastUsedAt: new Date(),
    },
  })

  console.log('✅ Created 4 sample projects')

  // =============================================================================
  // SAMPLE CATEGORY RULES
  // =============================================================================

  // 1. RECURRING EVENT RULE - High confidence (0.9)
  // Weekly standup always maps to Engineering project
  const recurringRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-recurring-standup' },
    update: {},
    create: {
      id: 'seed-rule-recurring-standup',
      userId: testUser.id,
      projectId: engineeringProject.id,
      ruleType: 'RECURRING_EVENT_ID',
      condition: 'recurring_standup_event_123', // Google recurring event ID
      confidenceScore: 0.9,
      matchCount: 25,
      totalSuggestions: 25,
      accuracy: 1.0, // 100% accuracy - always accepted
      lastMatchedAt: new Date(),
    },
  })
  console.log('✅ Created recurring event rule (high confidence)')

  // 2. EMAIL DOMAIN RULES - For different clients

  // Acme Corp domain rule
  const acmeDomainRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-acme-domain' },
    update: {},
    create: {
      id: 'seed-rule-acme-domain',
      userId: testUser.id,
      projectId: acmeClientProject.id,
      ruleType: 'ATTENDEE_DOMAIN',
      condition: 'acme.com', // Any email @acme.com
      confidenceScore: 0.8,
      matchCount: 12,
      totalSuggestions: 15,
      accuracy: 0.8, // 12/15 = 80% accuracy
      lastMatchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    },
  })

  // Globex Industries domain rule
  const globexDomainRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-globex-domain' },
    update: {},
    create: {
      id: 'seed-rule-globex-domain',
      userId: testUser.id,
      projectId: globexClientProject.id,
      ruleType: 'ATTENDEE_DOMAIN',
      condition: 'globexindustries.com',
      confidenceScore: 0.75,
      matchCount: 8,
      totalSuggestions: 10,
      accuracy: 0.8, // 8/10 = 80% accuracy
      lastMatchedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    },
  })

  // Specific attendee email rule (Acme client contact)
  const acmeContactRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-acme-contact' },
    update: {},
    create: {
      id: 'seed-rule-acme-contact',
      userId: testUser.id,
      projectId: acmeClientProject.id,
      ruleType: 'ATTENDEE_EMAIL',
      condition: 'john.smith@acme.com',
      confidenceScore: 0.85,
      matchCount: 6,
      totalSuggestions: 6,
      accuracy: 1.0, // 100% - always correct
      lastMatchedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    },
  })

  console.log('✅ Created 3 email/domain rules for clients')

  // 3. COMMON KEYWORD RULES

  // "standup" → Engineering/Internal project
  const standupKeywordRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-keyword-standup' },
    update: {},
    create: {
      id: 'seed-rule-keyword-standup',
      userId: testUser.id,
      projectId: engineeringProject.id,
      ruleType: 'TITLE_KEYWORD',
      condition: 'standup',
      confidenceScore: 0.7,
      matchCount: 30,
      totalSuggestions: 35,
      accuracy: 0.857, // 30/35 ≈ 85.7% accuracy
      lastMatchedAt: new Date(),
    },
  })

  // "review" → Internal project (code reviews, design reviews)
  const reviewKeywordRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-keyword-review' },
    update: {},
    create: {
      id: 'seed-rule-keyword-review',
      userId: testUser.id,
      projectId: internalProject.id,
      ruleType: 'TITLE_KEYWORD',
      condition: 'review',
      confidenceScore: 0.6,
      matchCount: 10,
      totalSuggestions: 15,
      accuracy: 0.667, // 10/15 ≈ 66.7% accuracy
      lastMatchedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
    },
  })

  // "planning" → Internal project
  const planningKeywordRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-keyword-planning' },
    update: {},
    create: {
      id: 'seed-rule-keyword-planning',
      userId: testUser.id,
      projectId: internalProject.id,
      ruleType: 'TITLE_KEYWORD',
      condition: 'planning',
      confidenceScore: 0.65,
      matchCount: 8,
      totalSuggestions: 10,
      accuracy: 0.8, // 8/10 = 80% accuracy
      lastMatchedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
  })

  // "demo" → Acme Client (product demos for client)
  const demoKeywordRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-keyword-demo' },
    update: {},
    create: {
      id: 'seed-rule-keyword-demo',
      userId: testUser.id,
      projectId: acmeClientProject.id,
      ruleType: 'TITLE_KEYWORD',
      condition: 'demo',
      confidenceScore: 0.7,
      matchCount: 5,
      totalSuggestions: 7,
      accuracy: 0.714, // 5/7 ≈ 71.4% accuracy
      lastMatchedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
    },
  })

  console.log('✅ Created 4 keyword rules')

  // 4. CALENDAR NAME RULE
  // Work calendar → Internal project
  const workCalendarRule = await prisma.categoryRule.upsert({
    where: { id: 'seed-rule-work-calendar' },
    update: {},
    create: {
      id: 'seed-rule-work-calendar',
      userId: testUser.id,
      projectId: internalProject.id,
      ruleType: 'CALENDAR_NAME',
      condition: 'primary', // Google Calendar ID
      confidenceScore: 0.5,
      matchCount: 50,
      totalSuggestions: 100,
      accuracy: 0.5, // 50/100 = 50% (many different projects on work calendar)
      lastMatchedAt: new Date(),
    },
  })

  console.log('✅ Created 1 calendar rule')

  // =============================================================================
  // SAMPLE CALENDAR EVENTS (for testing suggestions)
  // =============================================================================

  const sampleEvent1 = await prisma.calendarEvent.upsert({
    where: { id: 'seed-event-standup' },
    update: {},
    create: {
      id: 'seed-event-standup',
      userId: testUser.id,
      googleEventId: 'recurring_standup_event_123',
      calendarId: 'primary',
      title: 'Daily Engineering Standup',
      startTime: new Date(),
      endTime: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      attendees: JSON.parse(JSON.stringify([
        { email: 'team@internal.com', responseStatus: 'accepted' },
      ])),
      status: 'confirmed',
    },
  })

  const sampleEvent2 = await prisma.calendarEvent.upsert({
    where: { id: 'seed-event-acme-meeting' },
    update: {},
    create: {
      id: 'seed-event-acme-meeting',
      userId: testUser.id,
      googleEventId: 'event_acme_meeting_456',
      calendarId: 'primary',
      title: 'Product Demo - Acme Corp',
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000), // 1 hour
      attendees: JSON.parse(JSON.stringify([
        { email: 'john.smith@acme.com', responseStatus: 'accepted' },
        { email: 'jane.doe@acme.com', responseStatus: 'tentative' },
      ])),
      status: 'confirmed',
    },
  })

  console.log('✅ Created 2 sample calendar events')

  // =============================================================================
  // SAMPLE SUGGESTION LOGS (for analytics testing)
  // =============================================================================

  const log1 = await prisma.suggestionLog.create({
    data: {
      userId: testUser.id,
      eventId: sampleEvent1.id,
      suggestedProjectId: engineeringProject.id,
      confidence: 0.95, // Very high confidence (recurring + keyword match)
      outcome: 'ACCEPTED',
    },
  })

  const log2 = await prisma.suggestionLog.create({
    data: {
      userId: testUser.id,
      eventId: sampleEvent2.id,
      suggestedProjectId: acmeClientProject.id,
      confidence: 0.87, // High confidence (domain + email + keyword match)
      outcome: 'ACCEPTED',
    },
  })

  console.log('✅ Created 2 suggestion logs')

  // =============================================================================
  // SUMMARY
  // =============================================================================

  const ruleCount = await prisma.categoryRule.count({
    where: { userId: testUser.id },
  })

  console.log('\n📊 Seed Summary:')
  console.log(`  • User: ${testUser.email}`)
  console.log(`  • Projects: 4`)
  console.log(`  • Category Rules: ${ruleCount}`)
  console.log(`    - Recurring Event: 1 (0.9 confidence)`)
  console.log(`    - Email Domain: 2`)
  console.log(`    - Attendee Email: 1`)
  console.log(`    - Title Keyword: 4`)
  console.log(`    - Calendar: 1`)
  console.log(`  • Sample Events: 2`)
  console.log(`  • Suggestion Logs: 2`)
  console.log('\n✨ Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
