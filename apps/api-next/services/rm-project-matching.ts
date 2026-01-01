/**
 * RM Project Matching Service
 * Fuzzy matching algorithm to suggest RM project mappings for time-tracker projects
 */

/**
 * Match reason types
 */
export type MatchReason =
  | "exact"
  | "code_match"
  | "starts_with"
  | "word_match"
  | "contains"
  | "partial";

/**
 * Match result with score and reason
 */
export interface MatchScore {
  score: number; // 0-1
  reason: MatchReason;
}

/**
 * Project match suggestion
 */
export interface ProjectMatchSuggestion {
  localProjectId: string;
  localProjectName: string;
  rmProjectId: number;
  rmProjectName: string;
  rmProjectCode: string | null;
  score: number;
  reason: MatchReason;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for partial matching when other strategies don't match
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create 2D array for dynamic programming
  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity ratio from Levenshtein distance
 * Returns value between 0 and 1 (1 = identical)
 */
function levenshteinSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (str1.length === 0 || str2.length === 0) return 0.0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);
  return 1 - distance / maxLength;
}

/**
 * Normalize string for matching (lowercase, trim, remove extra spaces)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Calculate match score between local project and RM project
 */
export function calculateMatchScore(
  localProjectName: string,
  rmProject: { name: string; code?: string | null }
): MatchScore {
  const localName = normalizeString(localProjectName);
  const rmName = normalizeString(rmProject.name);
  const rmCode = rmProject.code ? normalizeString(rmProject.code) : null;

  // 1. Exact match (score: 1.0)
  if (localName === rmName) {
    return { score: 1.0, reason: "exact" };
  }

  // 2. Code match (score: 0.95) - if RM project has code and local name matches
  if (rmCode && localName === rmCode) {
    return { score: 0.95, reason: "code_match" };
  }

  // 3. Starts with (score: 0.85)
  if (rmName.startsWith(localName) || localName.startsWith(rmName)) {
    return { score: 0.85, reason: "starts_with" };
  }

  // 4. Word-level match (score: 0.75)
  // All words from shorter name exist in longer name
  const localWords = localName.split(/\s+/).filter((w) => w.length > 2); // Ignore short words
  const rmWords = rmName.split(/\s+/).filter((w) => w.length > 2);

  if (localWords.length > 0 && rmWords.length > 0) {
    const allWordsMatch =
      localWords.every((w) => rmWords.some((rw) => rw.includes(w))) ||
      rmWords.every((w) => localWords.some((lw) => lw.includes(w)));

    if (allWordsMatch) {
      return { score: 0.75, reason: "word_match" };
    }
  }

  // 5. Contains (score: 0.65)
  if (rmName.includes(localName) || localName.includes(rmName)) {
    return { score: 0.65, reason: "contains" };
  }

  // 6. Partial match using Levenshtein similarity (score: 0.4-0.6)
  const similarity = levenshteinSimilarity(localName, rmName);
  if (similarity > 0.6) {
    return { score: similarity * 0.6, reason: "partial" }; // Scale to max 0.6
  }

  // No match
  return { score: 0, reason: "partial" };
}

/**
 * Find best matching RM project for a local project
 * Returns null if no match exceeds minimum threshold
 */
export function findBestMatch(
  localProject: { id: string; name: string },
  rmProjects: Array<{ id: number; name: string; code?: string | null }>,
  minScore: number = 0.65
): ProjectMatchSuggestion | null {
  let bestMatch: ProjectMatchSuggestion | null = null;
  let bestScore = minScore;

  for (const rmProject of rmProjects) {
    const matchScore = calculateMatchScore(localProject.name, rmProject);

    if (matchScore.score > bestScore) {
      bestScore = matchScore.score;
      bestMatch = {
        localProjectId: localProject.id,
        localProjectName: localProject.name,
        rmProjectId: rmProject.id,
        rmProjectName: rmProject.name,
        rmProjectCode: rmProject.code || null,
        score: matchScore.score,
        reason: matchScore.reason,
      };
    }
  }

  return bestMatch;
}

/**
 * Generate match suggestions for all local projects
 * Returns map of localProjectId -> best matching RM project
 */
export function suggestMatches(
  localProjects: Array<{ id: string; name: string }>,
  rmProjects: Array<{ id: number; name: string; code?: string | null }>,
  minScore: number = 0.65
): Map<string, ProjectMatchSuggestion> {
  const suggestions = new Map<string, ProjectMatchSuggestion>();

  for (const localProject of localProjects) {
    const match = findBestMatch(localProject, rmProjects, minScore);
    if (match) {
      suggestions.set(localProject.id, match);
    }
  }

  return suggestions;
}

/**
 * Get high-confidence suggestions suitable for auto-mapping
 * Default threshold: 0.85 (exact, code_match, starts_with only)
 */
export function getAutoMapSuggestions(
  suggestions: Map<string, ProjectMatchSuggestion>,
  confidenceThreshold: number = 0.85
): ProjectMatchSuggestion[] {
  return Array.from(suggestions.values()).filter(
    (s) => s.score >= confidenceThreshold
  );
}

/**
 * Validate mapping doesn't create conflicts
 * Returns true if mapping is valid (no duplicates)
 */
export function validateMapping(
  newMapping: { localProjectId: string; rmProjectId: number },
  existingMappings: Array<{ localProjectId: string; rmProjectId: number }>
): { valid: boolean; error?: string } {
  // Check if local project already mapped
  const localExists = existingMappings.find(
    (m) => m.localProjectId === newMapping.localProjectId
  );
  if (localExists) {
    return {
      valid: false,
      error: "Local project already mapped to an RM project",
    };
  }

  // Check if RM project already mapped
  const rmExists = existingMappings.find(
    (m) => m.rmProjectId === newMapping.rmProjectId
  );
  if (rmExists) {
    return {
      valid: false,
      error: "RM project already mapped to a local project",
    };
  }

  return { valid: true };
}
