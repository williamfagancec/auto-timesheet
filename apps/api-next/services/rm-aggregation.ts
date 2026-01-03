/**
 * RM Aggregation Service
 * Aggregates timesheet entries by project-day for RM sync
 *
 * Aggregation Rules (from refactor plan):
 * - Group by: projectId + date
 * - Sum: duration (total minutes)
 * - Billable: all entries for a project have same isBillable (project property)
 * - Notes: single note field per project-day aggregate
 */

import { TimesheetEntry } from "database";
import crypto from "crypto";

/**
 * Aggregated entry result (one per project-day)
 */
export interface AggregatedEntry {
  // Grouping key
  projectId: string;
  date: Date;

  // Aggregated values
  totalMinutes: number;
  totalHours: number; // Calculated: totalMinutes / 60
  isBillable: boolean;
  notes: string | null;

  // Metadata
  contributingEntryIds: string[];
  contributingEntries: TimesheetEntry[];

  // Sync tracking
  aggregateHash: string;
}

/**
 * Aggregate timesheet entries by project-day
 *
 * @param entries - Timesheet entries to aggregate
 * @returns Map of aggregated entries keyed by "${projectId}|${dateString}"
 */
export function aggregateEntriesByProjectDay(
  entries: TimesheetEntry[]
): Map<string, AggregatedEntry> {
  const aggregates = new Map<string, AggregatedEntry>();

  // Group entries by project + date
  for (const entry of entries) {
    if (!entry.projectId) {
      // Skip entries without project
      continue;
    }

    const dateStr = entry.date.toISOString().split("T")[0]; // YYYY-MM-DD
    const key = `${entry.projectId}|${dateStr}`;

    if (!aggregates.has(key)) {
      // Create new aggregate
      aggregates.set(key, {
        projectId: entry.projectId,
        date: entry.date,
        totalMinutes: 0,
        totalHours: 0,
        isBillable: entry.isBillable,
        notes: entry.notes,
        contributingEntryIds: [],
        contributingEntries: [],
        aggregateHash: "",
      });
    }

    const aggregate = aggregates.get(key)!;

    // Add to aggregate
    aggregate.totalMinutes += entry.duration;
    aggregate.contributingEntryIds.push(entry.id);
    aggregate.contributingEntries.push(entry);

    // Use first non-null notes value (assumes single note per project-day as per refactor plan)
    if (!aggregate.notes && entry.notes) {
      aggregate.notes = entry.notes;
    }

    // Verify all entries have same billable status (sanity check - should always be true per project)
    if (aggregate.isBillable !== entry.isBillable) {
      console.warn(
        `[RM Aggregation] Mixed billable status detected for project ${entry.projectId} on ${dateStr}. ` +
        `This should not happen as billable is a project property. Using first entry's value.`
      );
    }
  }

  // Calculate total hours and hash for each aggregate
  for (const aggregate of aggregates.values()) {
    aggregate.totalHours = minutesToDecimalHours(aggregate.totalMinutes);
    aggregate.aggregateHash = calculateAggregateHash(aggregate);
  }

  return aggregates;
}

/**
 * Calculate hash for an aggregated entry
 * Hash includes: date + totalHours + isBillable + notes
 * This is used for change detection - if hash changes, RM entry needs update
 *
 * @param aggregate - The aggregated entry
 * @returns SHA-256 hash string
 */
export function calculateAggregateHash(aggregate: Pick<AggregatedEntry, 'date' | 'totalHours' | 'isBillable' | 'notes'>): string {
  const dateStr = aggregate.date.toISOString().split("T")[0]; // YYYY-MM-DD
  const content = `${dateStr}|${aggregate.totalHours}|${aggregate.isBillable}|${aggregate.notes || ""}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Convert minutes to decimal hours (rounded to 2 decimal places)
 *
 * @param minutes - Duration in minutes
 * @returns Decimal hours
 */
export function minutesToDecimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Map billable status to RM API task field
 * RM API doesn't have native billable field, so we use the task field
 *
 * @param isBillable - Billable status from timesheet entry
 * @returns Task string for RM API
 */
export function mapBillableToTask(isBillable: boolean): string {
  return isBillable ? "Billable" : "Business Development";
}

/**
 * Map RM API task field back to billable status
 *
 * @param task - Task string from RM API
 * @returns Billable status
 */
export function mapTaskToBillable(task: string | undefined | null): boolean {
  // Default to billable if task not specified or unrecognized
  if (!task) return true;
  return task.toLowerCase() !== "business development";
}
