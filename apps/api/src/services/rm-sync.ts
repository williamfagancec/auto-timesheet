import { prisma } from 'database';
import { RMSyncStatus, RMSyncDirection, TimesheetEntry, RMProjectMapping } from '@prisma/client';
import { rmApi, RMAuthError, RMRateLimitError, RMValidationError } from './rm-api.js';
import { getDecryptedToken } from './rm-connection.js';
import {
  calculateEntryHash,
  filterSyncableEntries,
  detectChanges,
  formatRMTimeEntry,
} from './rm-sync-helpers.js';

/**
 * Sync result returned to caller
 */
export interface SyncResult {
  entriesAttempted: number;
  entriesSuccess: number;
  entriesFailed: number;
  entriesSkipped: number;
  unmappedProjects: Array<{ id: string; name: string }>;
  errors: Array<{ entryId: string; error: string }>;
  syncLogId: string;
}

/**
 * Internal result for individual entry sync
 */
interface SyncEntryResult {
  success: boolean;
  rmEntry?: any;
  error?: string;
}

/**
 * Sync timeout (5 minutes)
 */
const SYNC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Sync timesheet entries for a specific week to RM
 *
 * @param userId - User ID
 * @param weekStartDate - Monday at midnight UTC
 * @returns Sync result with statistics
 * @throws Error if connection not found or sync fails catastrophically
 */
export async function syncTimeEntries(
  userId: string,
  weekStartDate: Date
): Promise<SyncResult> {
  // Create timeout promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Sync timeout exceeded (5 minutes)')), SYNC_TIMEOUT_MS);
  });

  // Create sync promise
  const syncPromise = performSync(userId, weekStartDate);

  // Race timeout vs sync
  return Promise.race([syncPromise, timeoutPromise]);
}

/**
 * Internal function to perform the actual sync logic
 */
async function performSync(userId: string, weekStartDate: Date): Promise<SyncResult> {
  // 1. Validate connection and get mappings
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
    include: {
      projectMappings: {
        where: { enabled: true },
        include: { project: true },
      },
    },
  });

  if (!connection) {
    throw new Error('RM connection not found. Please connect your RM account first.');
  }

  // 2. Check for concurrent sync
  const existingRunningSync = await prisma.rMSyncLog.findFirst({
    where: {
      connectionId: connection.id,
      status: RMSyncStatus.RUNNING,
    },
  });

  if (existingRunningSync) {
    throw new Error('A sync is already in progress. Please wait for it to complete.');
  }

  // 3. Get decrypted token
  const token = await getDecryptedToken(userId);

  // 4. Create sync log record (RUNNING)
  const syncLog = await prisma.rMSyncLog.create({
    data: {
      connectionId: connection.id,
      status: RMSyncStatus.RUNNING,
      direction: RMSyncDirection.PUSH,
      startedAt: new Date(),
    },
  });

  try {
    // 5. Fetch timesheet entries for the week
    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const allEntries = await prisma.timesheetEntry.findMany({
      where: {
        userId,
        date: { gte: weekStartDate, lt: weekEnd },
        isSkipped: false,
        projectId: { not: null },
        duration: { gt: 0 }, // Skip zero-hour entries
      },
      orderBy: { date: 'asc' },
    });

    // 6. Filter to syncable entries (with mappings)
    const { syncable, unmappedProjectIds } = filterSyncableEntries(
      allEntries,
      connection.projectMappings
    );

    // Get unmapped project names for user warning
    const unmappedProjects = await prisma.project.findMany({
      where: { id: { in: Array.from(unmappedProjectIds) } },
      select: { id: true, name: true },
    });

    // 7. Fetch existing synced records
    const entryIds = syncable.map(e => e.id);
    const existingSynced = await prisma.rMSyncedEntry.findMany({
      where: { timesheetEntryId: { in: entryIds } },
    });

    const syncedMap = new Map(existingSynced.map(s => [s.timesheetEntryId, s]));

    // 8. Detect changes
    const { newEntries, changedEntries, unchangedEntries } = detectChanges(syncable, syncedMap);

    // 9. Sync entries with retry logic
    const errors: Array<{ entryId: string; error: string }> = [];
    let successCount = 0;

    // Create mapping lookup
    const mappingByProjectId = new Map(
      connection.projectMappings.map(m => [m.projectId, m])
    );

    // Process new entries
    for (const entry of newEntries) {
      const mapping = mappingByProjectId.get(entry.projectId!);
      if (!mapping) continue;

      const result = await syncEntryWithRetry(
        'create',
        entry,
        mapping,
        token,
        connection.rmUserId
      );

      if (result.success && result.rmEntry) {
        successCount++;
        // Create synced entry record
        await prisma.rMSyncedEntry.create({
          data: {
            mappingId: mapping.id,
            timesheetEntryId: entry.id,
            rmEntryId: result.rmEntry.id,
            lastSyncedAt: new Date(),
            lastSyncedHash: calculateEntryHash(entry),
            syncVersion: 1,
          },
        });

        // Update mapping lastSyncedAt
        await prisma.rMProjectMapping.update({
          where: { id: mapping.id },
          data: { lastSyncedAt: new Date() },
        });
      } else {
        errors.push({ entryId: entry.id, error: result.error || 'Unknown error' });
      }
    }

    // Process changed entries
    for (const entry of changedEntries) {
      const mapping = mappingByProjectId.get(entry.projectId!);
      const synced = syncedMap.get(entry.id);

      if (!mapping || !synced) continue;

      const result = await syncEntryWithRetry(
        'update',
        entry,
        mapping,
        token,
        connection.rmUserId,
        synced.rmEntryId
      );

      if (result.success) {
        successCount++;
        // Update synced entry record
        await prisma.rMSyncedEntry.update({
          where: { id: synced.id },
          data: {
            lastSyncedAt: new Date(),
            lastSyncedHash: calculateEntryHash(entry),
            syncVersion: { increment: 1 },
          },
        });

        // Update mapping lastSyncedAt
        await prisma.rMProjectMapping.update({
          where: { id: mapping.id },
          data: { lastSyncedAt: new Date() },
        });
      } else {
        errors.push({ entryId: entry.id, error: result.error || 'Unknown error' });
      }
    }

    // 10. Update sync log
    const totalAttempted = newEntries.length + changedEntries.length;
    const finalStatus =
      errors.length === 0
        ? RMSyncStatus.COMPLETED
        : errors.length < totalAttempted
        ? RMSyncStatus.PARTIAL
        : RMSyncStatus.FAILED;

    await prisma.rMSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: finalStatus,
        entriesAttempted: totalAttempted,
        entriesSuccess: successCount,
        entriesFailed: errors.length,
        entriesSkipped: unchangedEntries.length,
        errorMessage: errors.length > 0 ? `${errors.length} entries failed` : null,
        errorDetails: errors.length > 0 ? (errors as any) : null,
        completedAt: new Date(),
      },
    });

    // 11. Update connection last sync time
    await prisma.rMConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date() },
    });

    return {
      entriesAttempted: totalAttempted,
      entriesSuccess: successCount,
      entriesFailed: errors.length,
      entriesSkipped: unchangedEntries.length,
      unmappedProjects,
      errors,
      syncLogId: syncLog.id,
    };
  } catch (error) {
    // Update sync log to FAILED
    await prisma.rMSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: RMSyncStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });

    throw error;
  }
}

/**
 * Sync a single entry with retry logic
 *
 * Implements exponential backoff for rate limit errors:
 * - First retry: 2 seconds
 * - Second retry: 4 seconds
 * - Third retry: 8 seconds
 *
 * Auth and validation errors fail fast without retry.
 *
 * @param operation - 'create' or 'update'
 * @param entry - Timesheet entry to sync
 * @param mapping - RM project mapping
 * @param token - Decrypted RM API token
 * @param rmUserId - RM user ID
 * @param rmEntryId - RM entry ID (required for update)
 * @param retries - Max retry attempts (default: 3)
 * @returns Sync result with success status and optional error
 */
async function syncEntryWithRetry(
  operation: 'create' | 'update',
  entry: TimesheetEntry,
  mapping: RMProjectMapping,
  token: string,
  rmUserId: number,
  rmEntryId?: number,
  retries = 3
): Promise<SyncEntryResult> {
  const rmTimeEntry = formatRMTimeEntry(entry, mapping);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      let rmEntry;
      if (operation === 'create') {
        rmEntry = await rmApi.createTimeEntry(token, rmUserId, rmTimeEntry);
      } else {
        if (!rmEntryId) {
          return { success: false, error: 'Missing RM entry ID for update operation' };
        }
        rmEntry = await rmApi.updateTimeEntry(token, rmUserId, rmEntryId, rmTimeEntry);
      }

      return { success: true, rmEntry };
    } catch (error) {
      // Handle rate limiting with exponential backoff
      if (error instanceof RMRateLimitError) {
        if (attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
          console.log(`[RM Sync] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return {
          success: false,
          error: 'RM API rate limit exceeded. Please try again later.',
        };
      }

      // Handle auth errors (don't retry)
      if (error instanceof RMAuthError) {
        return {
          success: false,
          error: 'RM authentication failed. Please reconnect your account in Settings.',
        };
      }

      // Handle validation errors (don't retry)
      if (error instanceof RMValidationError) {
        return {
          success: false,
          error: `Validation error: ${error.message}`,
        };
      }

      // Final attempt failed
      if (attempt === retries - 1) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      // Other errors: retry with delay
      console.log(`[RM Sync] Error, retrying in 2s (attempt ${attempt + 1}/${retries}):`, error);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return { success: false, error: 'Max retries exceeded' };
}
