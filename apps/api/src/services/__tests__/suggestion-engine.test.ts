import { describe, it, expect } from 'vitest'
import SuggestionEngine, { PatternExtractor, ConfidenceCalculator, Suggestion } from '../suggestion-engine'
import { AI_CONFIG } from 'config'
import type { CalendarEventInput } from '../ai-categorization'
import type { CategoryRule, Project } from '@prisma/client'

describe('SuggestionEngine', () => {
  it('returns top suggestion when confidence > 60%', async () => {
    const event: CalendarEventInput = {
      id: 'evt1',
      title: 'Weekly Sync',
      attendees: [],
      calendarId: 'primary',
      googleEventId: 'rec_1',
    }

    // Mock extractor that returns a recurring-event pattern
    const extractor: PatternExtractor = {
      extract: () => [{ ruleType: 'RECURRING_EVENT_ID', condition: 'rec_1' }],
    }

    // Mock rule returned from DB
    const mockProject: Project = {
      id: 'proj1',
      name: 'Project One',
      userId: 'user-1',
      isArchived: false,
      useCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    }

    const mockRule: CategoryRule & { project: Project } = {
      id: 'rule-1',
      userId: 'user-1',
      projectId: 'proj1',
      ruleType: 'RECURRING_EVENT_ID',
      condition: 'rec_1',
      confidenceScore: 1,
      accuracy: 1,
      matchCount: 1,
      totalSuggestions: 1,
      lastMatchedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      project: mockProject,
    }

    // Mock Prisma client with categoryRule.findMany
    const prismaMock: any = {
      categoryRule: {
        findMany: async (_opts: any) => [mockRule],
      },
    }

    // Mock confidence calculator returns high confidence for the rule
    const calculator: ConfidenceCalculator = {
      calculate: (_rule) => 0.9,
    }

  const engine = new SuggestionEngine({ extractor, calculator, prisma: prismaMock, minConfidenceThreshold: AI_CONFIG.minConfidenceThreshold })

    const suggestion = await engine.generateSuggestion(event, 'user-1')

    expect(suggestion).toBeDefined()
    expect(suggestion).not.toBeNull()
    expect((suggestion as Suggestion).projectId).toBe('proj1')
    expect((suggestion as Suggestion).projectName).toBe('Project One')
    expect((suggestion as Suggestion).confidence).toBeCloseTo(0.9)
    expect((suggestion as Suggestion).reasoning).toContain('Recurring event pattern')
  })

  it('returns null when top confidence <= 60%', async () => {
    const event: CalendarEventInput = {
      id: 'evt2',
      title: 'Quick Chat',
      attendees: [{ email: 'john@acme.com' }],
      calendarId: 'primary',
      googleEventId: null,
    }

    const extractor: PatternExtractor = {
      extract: () => [{ ruleType: 'ATTENDEE_EMAIL', condition: 'john@acme.com' }],
    }

    const mockProject: Project = {
      id: 'proj2',
      name: 'Project Two',
      userId: 'user-1',
      isArchived: false,
      useCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    }

    const mockRule: CategoryRule & { project: Project } = {
      id: 'rule-2',
      userId: 'user-1',
      projectId: 'proj2',
      ruleType: 'ATTENDEE_EMAIL',
      condition: 'john@acme.com',
      confidenceScore: 0.5,
      accuracy: 0.2,
      matchCount: 1,
      totalSuggestions: 1,
      lastMatchedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: mockProject,
    }

    const prismaMock: any = {
      categoryRule: {
        findMany: async (_opts: any) => [mockRule],
      },
    }

    const calculator: ConfidenceCalculator = {
      calculate: (_rule) => 0.4,
    }

  const engine = new SuggestionEngine({ extractor, calculator, prisma: prismaMock, minConfidenceThreshold: AI_CONFIG.minConfidenceThreshold })

    const suggestion = await engine.generateSuggestion(event, 'user-1')

    expect(suggestion).toBeNull()
  })
})
