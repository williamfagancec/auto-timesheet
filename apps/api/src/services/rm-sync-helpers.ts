import crypto from 'crypto';
import { TimesheetEntry, RMProjectMapping, RMSyncedEntry } from '@prisma/client';

/**
 * RM time entry format for API calls
 */
export interface CreateRMTimeEntryInput {
  assignable_id: number;
  date: string; // YYYY-MM-DD format
  hours: number;
  notes?: string;
}

/**
 * Calculate SHA-256 hash for a timesheet entry
 * Hash format: `${date}_${projectId}_${hours}_${notes}`
 *
 * This hash is used to detect changes in entries and avoid unnecessary API calls.
 * When the hash changes, we know the entry needs to be updated in RM.
 */
export function calculateEntryHash(entry: {
  date: Date;
  projectId: string | null;
  duration: number; // in minutes
  notes: string | null;
}): string {
  const hours = (entry.duration / 60).toFixed(2);
  const notes = entry.notes?.trim() || '';
  const dateStr = entry.date.toISOString().split('T')[0]; // YYYY-MM-DD

  const dataStr = `${dateStr}_${entry.projectId}_${hours}_${notes}`;
  return crypto.createHash('sha256').update(dataStr).digest('hex');
}

/**
 * Filter timesheet entries to only those with RM project mappings
 *
 * @returns Object with syncable entries and unmapped project IDs
 */
export function filterSyncableEntries(
  entries: TimesheetEntry[],
  mappings: RMProjectMapping[]
): {
  syncable: TimesheetEntry[];
  unmappedProjectIds: Set<string>;
} {
  const mappedProjectIds = new Set(mappings.map(m => m.projectId));
  const syncable: TimesheetEntry[] = [];
  const unmappedProjectIds = new Set<string>();

  for (const entry of entries) {
    // Skip entries without a project
    if (!entry.projectId) continue;

    if (mappedProjectIds.has(entry.projectId)) {
      syncable.push(entry);
    } else {
      unmappedProjectIds.add(entry.projectId);
    }
  }

  return { syncable, unmappedProjectIds };
}

/**
 * Detect which entries have changed since last sync by comparing hashes
 *
 * @param entries - Current timesheet entries to sync
 * @param syncedRecords - Map of existing synced records (key: timesheetEntryId)
 * @returns Categorized entries (new, changed, unchanged)
 */
export function detectChanges(
  entries: TimesheetEntry[],
  syncedRecords: Map<string, RMSyncedEntry>
): {
  newEntries: TimesheetEntry[];
  changedEntries: TimesheetEntry[];
  unchangedEntries: TimesheetEntry[];
} {
  const newEntries: TimesheetEntry[] = [];
  const changedEntries: TimesheetEntry[] = [];
  const unchangedEntries: TimesheetEntry[] = [];

  for (const entry of entries) {
    const synced = syncedRecords.get(entry.id);

    // Entry has never been synced
    if (!synced) {
      newEntries.push(entry);
      continue;
    }

    // Compare current hash with last synced hash
    const currentHash = calculateEntryHash(entry);
    if (currentHash !== synced.lastSyncedHash) {
      changedEntries.push(entry);
    } else {
      unchangedEntries.push(entry);
    }
  }

  return { newEntries, changedEntries, unchangedEntries };
}

/**
 * Transform timesheet entry to RM API format
 *
 * @param entry - Timesheet entry to format
 * @param mapping - Project mapping with RM project ID
 * @returns Formatted time entry ready for RM API
 */
export function formatRMTimeEntry(
  entry: TimesheetEntry,
  mapping: RMProjectMapping
): CreateRMTimeEntryInput {
  const hours = entry.duration / 60;
  const dateStr = entry.date.toISOString().split('T')[0]; // YYYY-MM-DD

  return {
    assignable_id: mapping.rmProjectId,
    date: dateStr,
    hours: parseFloat(hours.toFixed(2)),
    notes: entry.notes?.trim() || undefined,
  };
}
