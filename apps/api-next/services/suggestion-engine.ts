import { PrismaClient, CategoryRule, Project } from 'database'
import { calculateCombinedConfidence } from './ai-categorization'
import type { CalendarEventInput } from './ai-categorization'
import { AI_CONFIG } from 'config'
import { RuleCache } from './rule-cache'

// Minimal Pattern type used by the extractor
export interface Pattern {
  ruleType: CategoryRule['ruleType'] | string
  condition: string
}

// DI interfaces
export interface PatternExtractor {
  extract(event: CalendarEventInput): Pattern[] | Promise<Pattern[]>
}

export interface ConfidenceCalculator {
  calculate(rule: CategoryRule): number
}

// Public Suggestion interface required by the user
export interface Suggestion {
  projectId: string
  projectName: string
  confidence: number // 0.0 - 1.0
  reasoning: string[]
}

export class SuggestionEngine {
  private readonly extractor: PatternExtractor
  private readonly calculator: ConfidenceCalculator
  private readonly prisma: PrismaClient
  private readonly threshold: number
  private readonly ruleCache: RuleCache

  constructor(opts: {
    extractor: PatternExtractor
    calculator: ConfidenceCalculator
    prisma: PrismaClient
    minConfidenceThreshold?: number // 0.0 - 1.0 (default from AI_CONFIG)
    ruleCache?: RuleCache
  }) {
    this.extractor = opts.extractor
    this.calculator = opts.calculator
    this.prisma = opts.prisma
    this.threshold =
      typeof opts.minConfidenceThreshold === 'number'
        ? opts.minConfidenceThreshold
        : AI_CONFIG.minConfidenceThreshold
    this.ruleCache = opts.ruleCache ?? new RuleCache(5 * 60 * 1000)
  }

  // Helper to render human-friendly reasoning strings per rule
  private reasoningForRule(rule: CategoryRule): string {
    switch (rule.ruleType) {
      case 'RECURRING_EVENT_ID':
        return 'Recurring event pattern'
      case 'ATTENDEE_EMAIL':
        return `Attendee: ${rule.condition}`
      case 'ATTENDEE_DOMAIN':
        return `Attendee domain: @${rule.condition}`
      case 'TITLE_KEYWORD':
        return `Keyword: ${rule.condition}`
      case 'CALENDAR_NAME':
        return `Calendar: ${rule.condition}`
      default:
        return `Pattern: ${rule.condition}`
    }
  }

  // Main API: generate one top suggestion or null
  public async generateSuggestion(event: CalendarEventInput, userId: string): Promise<Suggestion | null> {
    return this.processEventWithCachedRules(event, userId)
  }

  private async processEventWithCachedRules(event: CalendarEventInput, userId: string): Promise<Suggestion | null> {
    const rules = await this.ruleCache.getRulesForUser(userId, this.prisma)
    if (!rules || rules.length === 0) return null
    return this.processEventWithRules(event, rules)
  }

  private async processEventWithRules(event: CalendarEventInput, rules: (CategoryRule & { project: Project })[]): Promise<Suggestion | null> {
    const patterns = await Promise.resolve(this.extractor.extract(event))

    const matchingRules = rules.filter((rule) =>
      patterns.some((p) => p.ruleType === rule.ruleType && p.condition === rule.condition)
    )

    if (matchingRules.length === 0) return null

    const scored = matchingRules.map((rule) => ({ rule, confidence: this.calculator.calculate(rule) }))

    const byProject = new Map<string, { project: Project; confidences: number[]; rules: CategoryRule[] }>()
    for (const s of scored) {
      const pid = s.rule.projectId
      if (!byProject.has(pid)) {
        byProject.set(pid, { project: (s.rule as any).project as Project, confidences: [], rules: [] })
      }
      const entry = byProject.get(pid)!
      entry.confidences.push(s.confidence)
      entry.rules.push(s.rule)
    }

    const suggestions: Array<{ projectId: string; project: Project; confidence: number; rules: CategoryRule[] }> = []
    for (const [projectId, entry] of byProject.entries()) {
      const combined = calculateCombinedConfidence(entry.confidences)
      suggestions.push({ projectId, project: entry.project, confidence: combined, rules: entry.rules })
    }

    if (suggestions.length === 0) return null

    suggestions.sort((a, b) => b.confidence - a.confidence)
    const top = suggestions[0]
    if (top.confidence < this.threshold) return null

    const reasoningSet = new Set<string>()
    for (const rule of top.rules) reasoningSet.add(this.reasoningForRule(rule))

    return {
      projectId: top.projectId,
      projectName: top.project.name,
      confidence: top.confidence,
      reasoning: Array.from(reasoningSet),
    }
  }

  /**
   * Generate suggestions for multiple events in a batch.
   * Fetches all events in one DB query and caches rules for the session.
   */
  public async generateBatchSuggestions(eventIds: string[], userId: string): Promise<Map<string, Suggestion | null>> {
    if (!eventIds || eventIds.length === 0) return new Map()

    // Fetch all events in one query
    const events = await this.prisma.calendarEvent.findMany({ where: { id: { in: eventIds }, userId } })

    // Build map of id->event for lookup
    const eventById = new Map<string, any>(events.map((e: any) => [e.id, e]))

    // Load rules once via the cache
    const rules = await this.ruleCache.getRulesForUser(userId, this.prisma)

    const result = new Map<string, Suggestion | null>()

    // Process each event (reuse processEventWithRules which encapsulates matching & aggregation)
    for (const id of eventIds) {
      const event = eventById.get(id)
      if (!event) {
        result.set(id, null)
        continue
      }

      const input: CalendarEventInput = {
        id: event.id,
        title: event.title,
        attendees: event.attendees || undefined,
        calendarId: event.calendarId,
        googleEventId: event.googleEventId || null,
      }

      const suggestion = await this.processEventWithRules(input, rules)
      result.set(id, suggestion)
    }

    return result
  }
}

export default SuggestionEngine
