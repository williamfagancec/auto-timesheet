import { prisma } from 'database'
import SuggestionEngine, { PatternExtractor, ConfidenceCalculator } from './suggestion-engine.js'
import { extractPatternsFromEvent, calculateRuleConfidence } from './ai-categorization.js'
import { RuleCache } from './rule-cache.js'

export function createDefaultSuggestionEngine() {
  const extractor: PatternExtractor = {
    extract: (event) => extractPatternsFromEvent(event),
  }

  const calculator: ConfidenceCalculator = {
    calculate: (rule) => calculateRuleConfidence(rule),
  }

  const ruleCache = new RuleCache(5 * 60 * 1000)

  return new SuggestionEngine({ extractor, calculator, prisma, ruleCache })
}

export default createDefaultSuggestionEngine
