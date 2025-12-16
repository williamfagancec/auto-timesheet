/**
 * RM Sync Service
 * Orchestrates syncing timesheet entries to Resource Management
 *
 * Uses a partial unique index on RMSyncLog(connectionId) WHERE status='RUNNING'
 * to prevent race conditions. The startSync function attempts to create a RUNNING
 * log unconditionally and catches constraint violations to prevent duplicate syncs.
 */

import { prisma } from "database";
import { Prisma, RMSyncStatus, RMSyncDirection } from "@prisma/client";
import { rmApi, RMRateLimitError, RMNotFoundError } from "./rm-api.js";
import { getDecryptedToken } from "./rm-connection.js";
import {
  aggregateEntriesByProjectDay,
  mapBillableToTask,
} from "./rm-aggregation.js";

/**
 * Custom error for sync-related issues
 */
export class RMSyncError extends Error {
  constructor(
    message: string,
    public code: "SYNC_IN_PROGRESS" | "NO_CONNECTION" | "SYNC_FAILED" | "INVALID_STATE" | "NO_RM_USER_ID"
  ) {
    super(message);
    this.name = "RMSyncError";
  }
}

/**
 * Result of starting a sync operation
 */
export interface SyncStartResult {
  syncLogId: string;
  connectionId: string;
}

/**
 * Result of completing a sync operation
 */
export interface SyncCompleteResult {
  success: boolean;
  entriesAttempted: number;
  entriesSuccess: number;
  entriesFailed: number;
  entriesSkipped: number;
}

/**
 * Start a new sync operation
 *
 * This function uses an atomic insert pattern to prevent race conditions:
 * 1. Attempts to create a RUNNING sync log unconditionally
 * 2. If unique constraint violation occurs (P2002), another sync is already running
 * 3. The partial unique index ensures only one RUNNING sync per connection
 *
 * @param userId - The user ID initiating the sync
 * @param direction - Sync direction (default: PUSH)
 * @returns The created sync log ID and connection ID
 * @throws RMSyncError if sync already in progress or no connection exists
 */
export async function startSync(
  userId: string,
  direction: RMSyncDirection = RMSyncDirection.PUSH
): Promise<SyncStartResult> {
  // Get the user's RM connection
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    throw new RMSyncError(
      "No RM connection found - please connect your RM account first",
      "NO_CONNECTION"
    );
  }

  try {
    // Attempt to create a RUNNING sync log unconditionally
    // The partial unique index will prevent duplicates
    const syncLog = await prisma.rMSyncLog.create({
      data: {
        connectionId: connection.id,
        status: RMSyncStatus.RUNNING,
        direction,
        entriesAttempted: 0,
        entriesSuccess: 0,
        entriesFailed: 0,
        entriesSkipped: 0,
      },
    });

    console.log(`[RM Sync] Started sync ${syncLog.id} for connection ${connection.id}`);

    return {
      syncLogId: syncLog.id,
      connectionId: connection.id,
    };
  } catch (error) {
    // Check if this is a unique constraint violation (P2002)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another sync is already running for this connection
      throw new RMSyncError(
        "A sync operation is already in progress for this connection. Please wait for it to complete.",
        "SYNC_IN_PROGRESS"
      );
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Complete a sync operation with final status and stats
 *
 * @param syncLogId - The sync log ID to complete
 * @param status - Final status (COMPLETED, FAILED, or PARTIAL)
 * @param stats - Final statistics for the sync
 * @param errorMessage - Optional error message if failed
 * @param errorDetails - Optional detailed error info for debugging
 */
export async function completeSync(
  syncLogId: string,
  status: RMSyncStatus,
  stats: {
    entriesAttempted: number;
    entriesSuccess: number;
    entriesFailed: number;
    entriesSkipped: number;
  },
  errorMessage?: string,
  errorDetails?: Record<string, unknown>
): Promise<SyncCompleteResult> {
  // Validate status - RUNNING is not a valid completion status
  if (status === RMSyncStatus.RUNNING || status === RMSyncStatus.PENDING) {
    throw new RMSyncError(
      `Invalid completion status: ${status}. Must be COMPLETED, FAILED, or PARTIAL`,
      "INVALID_STATE"
    );
  }

  const syncLog = await prisma.rMSyncLog.update({
    where: { id: syncLogId },
    data: {
      status,
      entriesAttempted: stats.entriesAttempted,
      entriesSuccess: stats.entriesSuccess,
      entriesFailed: stats.entriesFailed,
      entriesSkipped: stats.entriesSkipped,
      errorMessage: errorMessage || null,
      errorDetails: errorDetails ? (errorDetails as Prisma.InputJsonValue) : Prisma.JsonNull,
      completedAt: new Date(),
    },
  });

  console.log(
    `[RM Sync] Completed sync ${syncLogId} with status ${status}: ` +
      `${stats.entriesSuccess}/${stats.entriesAttempted} succeeded, ` +
      `${stats.entriesFailed} failed, ${stats.entriesSkipped} skipped`
  );

  // Update the connection's lastSyncAt timestamp
  await prisma.rMConnection.update({
    where: { id: syncLog.connectionId },
    data: { lastSyncAt: new Date() },
  });

  return {
    success: status === RMSyncStatus.COMPLETED,
    entriesAttempted: stats.entriesAttempted,
    entriesSuccess: stats.entriesSuccess,
    entriesFailed: stats.entriesFailed,
    entriesSkipped: stats.entriesSkipped,
  };
}

/**
 * Get the current running sync for a connection (if any)
 *
 * @param connectionId - The connection ID to check
 * @returns The running sync log or null
 */
export async function getRunningSync(connectionId: string) {
  return prisma.rMSyncLog.findFirst({
    where: {
      connectionId,
      status: RMSyncStatus.RUNNING,
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}

/**
 * Get sync history for a connection
 *
 * @param connectionId - The connection ID
 * @param limit - Maximum number of logs to return (default: 10)
 * @returns Array of sync logs, newest first
 */
export async function getSyncHistory(connectionId: string, limit: number = 10) {
  return prisma.rMSyncLog.findMany({
    where: { connectionId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

/**
 * Cancel a stuck RUNNING sync (for cleanup purposes)
 * Should only be called when sync is genuinely stuck (e.g., process crashed)
 *
 * @param syncLogId - The sync log ID to cancel
 * @param reason - Reason for cancellation
 */
export async function cancelStuckSync(syncLogId: string, reason: string): Promise<void> {
  await prisma.rMSyncLog.update({
    where: { id: syncLogId },
    data: {
      status: RMSyncStatus.FAILED,
      errorMessage: `Sync cancelled: ${reason}`,
      completedAt: new Date(),
    },
  });

  console.log(`[RM Sync] Cancelled stuck sync ${syncLogId}: ${reason}`);
}

// NOTE: calculateEntryHash and minutesToDecimalHours have been moved to rm-aggregation.ts
// and are now imported from there. These functions are kept here for backward compatibility
// during migration period, but should be removed once all code is updated.
// The old single-entry hash function is no longer used - we now use calculateAggregateHash.

/**
 * Single entry sync result
 */
interface EntrySyncResult {
  timesheetEntryId: string;
  status: "success" | "failed" | "skipped";
  action?: "created" | "updated" | "no_change";
  rmEntryId?: number;
  error?: string;
}

/**
 * Sync preview result (dry-run mode)
 * Shows aggregated entries (one per project-day)
 */
export interface SyncPreviewResult {
  totalEntries: number; // Total aggregated entries (not individual entries)
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  unmappedProjects: Array<{ projectId: string; projectName: string }>;
  entries: Array<{
    timesheetEntryIds: string[]; // IDs of contributing timesheet entries
    projectName: string;
    date: string;
    hours: number; // Aggregated total hours
    isBillable: boolean; // Billable status for the aggregate
    notes: string | null; // Combined notes
    action: "create" | "update" | "skip";
    reason?: string;
    componentCount: number; // Number of entries in this aggregate
  }>;
}

/**
 * Sync execution result
 */
export interface SyncExecutionResult {
  syncLogId: string;
  status: RMSyncStatus;
  entriesAttempted: number;
  entriesSuccess: number;
  entriesFailed: number;
  entriesSkipped: number;
  errors: Array<{ entryId: string; error: string }>;
}

/**
 * Preview sync without making API calls
 * Shows what would be created/updated/skipped (aggregated by project-day)
 * @param forceSync - If true, ignores hash comparison and treats all synced entries as needing update
 */
export async function previewSync(
  userId: string,
  fromDate: Date,
  toDate: Date,
  forceSync: boolean = false
): Promise<SyncPreviewResult> {
  console.log('[RM Sync] Preview sync starting:', { userId, fromDate, toDate, forceSync });

  // Get user's RM connection
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    console.error('[RM Sync] No RM connection found for user:', userId);
    throw new RMSyncError(
      "No RM connection found - please connect your RM account first",
      "NO_CONNECTION"
    );
  }

  console.log('[RM Sync] Found connection:', { connectionId: connection.id });

  // Get all project mappings
  const mappings = await prisma.rMProjectMapping.findMany({
    where: {
      connectionId: connection.id,
      enabled: true,
    },
    include: {
      project: true,
    },
  });

  const mappingByProjectId = new Map(
    mappings.map((m) => [m.projectId, m])
  );

  console.log('[RM Sync] Found project mappings:', mappings.length);

  // Get timesheet entries in date range
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      userId,
      date: {
        gte: fromDate,
        lte: toDate,
      },
      projectId: {
        not: null,
      },
      isSkipped: false,
    },
    include: {
      project: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  console.log('[RM Sync] Found timesheet entries:', entries.length);

  // Aggregate entries by project-day
  const aggregates = aggregateEntriesByProjectDay(entries);
  console.log('[RM Sync] Created aggregates:', aggregates.size);

  const preview: SyncPreviewResult = {
    totalEntries: aggregates.size, // Total number of aggregated entries (project-days)
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    unmappedProjects: [],
    entries: [],
  };

  const unmappedProjectIds = new Set<string>();

  // For each aggregate, check if it needs to be synced
  for (const aggregate of aggregates.values()) {
    const projectId = aggregate.projectId;
    const dateStr = aggregate.date.toISOString().split("T")[0];

    // Get project name
    const project = entries.find(e => e.projectId === projectId)?.project;
    const projectName = project?.name || "Unknown Project";

    // Check if hours are zero
    if (aggregate.totalHours === 0) {
      preview.toSkip++;
      preview.entries.push({
        timesheetEntryIds: aggregate.contributingEntryIds,
        projectName,
        date: dateStr,
        hours: aggregate.totalHours,
        isBillable: aggregate.isBillable,
        notes: aggregate.notes,
        action: "skip",
        reason: "Zero hours",
        componentCount: aggregate.contributingEntries.length,
      });
      continue;
    }

    // Check if project is mapped
    const mapping = mappingByProjectId.get(projectId);
    if (!mapping) {
      if (!unmappedProjectIds.has(projectId)) {
        unmappedProjectIds.add(projectId);
        preview.unmappedProjects.push({
          projectId,
          projectName,
        });
      }
      preview.toSkip++;
      preview.entries.push({
        timesheetEntryIds: aggregate.contributingEntryIds,
        projectName,
        date: dateStr,
        hours: aggregate.totalHours,
        isBillable: aggregate.isBillable,
        notes: aggregate.notes,
        action: "skip",
        reason: "Project not mapped to RM",
        componentCount: aggregate.contributingEntries.length,
      });
      continue;
    }

    // Check if aggregate already synced (find RMSyncedEntry by mappingId + aggregationDate)
    const existingSyncedEntry = await prisma.rMSyncedEntry.findUnique({
      where: {
        mappingId_aggregationDate: {
          mappingId: mapping.id,
          aggregationDate: aggregate.date,
        },
      },
    });

    if (existingSyncedEntry) {
      // If forceSync is enabled, always update synced entries (bypass hash check)
      if (forceSync) {
        preview.toUpdate++;
        preview.entries.push({
          timesheetEntryIds: aggregate.contributingEntryIds,
          projectName,
          date: dateStr,
          hours: aggregate.totalHours,
          isBillable: aggregate.isBillable,
          notes: aggregate.notes,
          action: "update",
          reason: "Force sync enabled",
          componentCount: aggregate.contributingEntries.length,
        });
      } else if (aggregate.aggregateHash === existingSyncedEntry.lastSyncedHash) {
        preview.toSkip++;
        preview.entries.push({
          timesheetEntryIds: aggregate.contributingEntryIds,
          projectName,
          date: dateStr,
          hours: aggregate.totalHours,
          isBillable: aggregate.isBillable,
          notes: aggregate.notes,
          action: "skip",
          reason: "Already synced, no changes",
          componentCount: aggregate.contributingEntries.length,
        });
      } else {
        preview.toUpdate++;
        preview.entries.push({
          timesheetEntryIds: aggregate.contributingEntryIds,
          projectName,
          date: dateStr,
          hours: aggregate.totalHours,
          isBillable: aggregate.isBillable,
          notes: aggregate.notes,
          action: "update",
          reason: "Content changed since last sync",
          componentCount: aggregate.contributingEntries.length,
        });
      }
    } else {
      preview.toCreate++;
      preview.entries.push({
        timesheetEntryIds: aggregate.contributingEntryIds,
        projectName,
        date: dateStr,
        hours: aggregate.totalHours,
        isBillable: aggregate.isBillable,
        notes: aggregate.notes,
        action: "create",
        componentCount: aggregate.contributingEntries.length,
      });
    }
  }

  return preview;
}

/**
 * Execute sync for timesheet entries in date range (using aggregation)
 * This performs the actual API calls to RM, syncing one aggregated entry per project-day
 * @param forceSync - If true, ignores hash comparison and always updates/creates entries in RM
 */
export async function executeSyncEntries(
  userId: string,
  syncLogId: string,
  fromDate: Date,
  toDate: Date,
  forceSync: boolean = false
): Promise<SyncExecutionResult> {
  // Wrap entire execution in try/catch to ensure we ALWAYS complete the sync
  // This prevents stuck RUNNING syncs when catastrophic errors occur
  try {
    // Get user's RM connection
    const connection = await prisma.rMConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      // Mark sync as failed before throwing
      await completeSync(
        syncLogId,
        RMSyncStatus.FAILED,
        { entriesAttempted: 0, entriesSuccess: 0, entriesFailed: 0, entriesSkipped: 0 },
        "No RM connection found",
        { error: "NO_CONNECTION" }
      );

      throw new RMSyncError(
        "No RM connection found - please connect your RM account first",
        "NO_CONNECTION"
      );
    }

    // Get user's RM user ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { rmUserId: true },
    });

    if (!user?.rmUserId) {
      await completeSync(
        syncLogId,
        RMSyncStatus.FAILED,
        { entriesAttempted: 0, entriesSuccess: 0, entriesFailed: 0, entriesSkipped: 0 },
        "RM user ID not set - please set your RM user ID in Settings",
        { error: "NO_RM_USER_ID" }
      );

      throw new RMSyncError(
        "RM user ID not set - please set your RM user ID in Settings",
        "NO_RM_USER_ID"
      );
    }

    const rmUserId = user.rmUserId;

  // Get decrypted API token
  const token = await getDecryptedToken(userId);

  // Get all project mappings
  const mappings = await prisma.rMProjectMapping.findMany({
    where: {
      connectionId: connection.id,
      enabled: true,
    },
  });

  const mappingByProjectId = new Map(
    mappings.map((m) => [m.projectId, m])
  );

  // Get timesheet entries in date range (no rmSyncedEntry include needed)
  const entries = await prisma.timesheetEntry.findMany({
    where: {
      userId,
      date: {
        gte: fromDate,
        lte: toDate,
      },
      projectId: {
        not: null,
      },
      isSkipped: false,
    },
    orderBy: {
      date: "asc",
    },
  });

  console.log('[RM Sync] Found timesheet entries:', entries.length);

  // Aggregate entries by project-day
  const aggregates = aggregateEntriesByProjectDay(entries);
  console.log('[RM Sync] Created aggregates:', aggregates.size);

  const results: EntrySyncResult[] = [];
  let attempted = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Process each aggregate
  for (const aggregate of aggregates.values()) {
    const projectId = aggregate.projectId;
    const dateStr = aggregate.date.toISOString().split("T")[0];

    // Check if hours are zero
    if (aggregate.totalHours === 0) {
      skipped++;
      for (const entryId of aggregate.contributingEntryIds) {
        results.push({
          timesheetEntryId: entryId,
          status: "skipped",
          error: "Zero hours",
        });
      }
      continue;
    }

    // Check if project is mapped
    const mapping = mappingByProjectId.get(projectId);
    if (!mapping) {
      skipped++;
      for (const entryId of aggregate.contributingEntryIds) {
        results.push({
          timesheetEntryId: entryId,
          status: "skipped",
          error: "Project not mapped to RM",
        });
      }
      continue;
    }

    attempted++;

    try {
      // Check if aggregate already synced (find by mappingId + aggregationDate)
      const existingSyncedEntry = await prisma.rMSyncedEntry.findUnique({
        where: {
          mappingId_aggregationDate: {
            mappingId: mapping.id,
            aggregationDate: aggregate.date,
          },
        },
      });

      // Determine if we need to sync
      const needsSync = !existingSyncedEntry ||
                        forceSync ||
                        aggregate.aggregateHash !== existingSyncedEntry.lastSyncedHash;

      if (existingSyncedEntry && !needsSync) {
        // Skip - no changes
        skipped++;
        attempted--; // Don't count no-change as attempted
        for (const entryId of aggregate.contributingEntryIds) {
          results.push({
            timesheetEntryId: entryId,
            status: "skipped",
            action: "no_change",
            rmEntryId: Number(existingSyncedEntry.rmEntryId),
          });
        }
        continue;
      }

      // Prepare RM API payload with billable status
      const rmPayload = {
        assignable_id: mapping.rmProjectId,
        date: dateStr,
        hours: aggregate.totalHours,
        notes: aggregate.notes || undefined,
        task: mapBillableToTask(aggregate.isBillable), // Map boolean to task string
      };

      let rmEntry;
      let action: "created" | "updated";

      if (existingSyncedEntry) {
        // Update existing entry in RM
        console.log('[RM Sync] Updating RM entry:', {
          rmEntryId: existingSyncedEntry.rmEntryId,
          ...rmPayload,
        });

        try {
          rmEntry = await rmApi.updateTimeEntry(
            token,
            rmUserId,
            Number(existingSyncedEntry.rmEntryId),
            rmPayload
          );
          action = "updated";
        } catch (updateError) {
          // If entry was deleted in RM (404), recreate it
          if (updateError instanceof RMNotFoundError) {
            console.log(`[RM Sync] Entry ${existingSyncedEntry.rmEntryId} not found in RM (likely deleted), recreating...`);

            // Delete orphaned sync record and components
            await prisma.rMSyncedEntry.delete({
              where: { id: existingSyncedEntry.id },
            });

            // Create new entry in RM
            rmEntry = await rmApi.createTimeEntry(token, rmUserId, rmPayload);
            action = "created";
            console.log(`[RM Sync] Successfully recreated entry in RM with new ID ${rmEntry.id}`);
          } else {
            // Re-throw other errors
            throw updateError;
          }
        }

        // Update synced entry record
        await prisma.rMSyncedEntry.update({
          where: { id: existingSyncedEntry.id },
          data: {
            rmEntryId: rmEntry.id,
            lastSyncedAt: new Date(),
            lastSyncedHash: aggregate.aggregateHash,
            syncVersion: { increment: 1 },
          },
        });

        // Delete old component records
        await prisma.rMSyncedEntryComponent.deleteMany({
          where: { rmSyncedEntryId: existingSyncedEntry.id },
        });

        // Create new component records
        await prisma.rMSyncedEntryComponent.createMany({
          data: aggregate.contributingEntries.map(entry => ({
            rmSyncedEntryId: existingSyncedEntry.id,
            timesheetEntryId: entry.id,
            durationMinutes: entry.duration,
            isBillable: entry.isBillable,
            notes: entry.notes,
          })),
        });
      } else {
        // Create new entry in RM
        console.log('[RM Sync] Creating RM entry:', rmPayload);

        rmEntry = await rmApi.createTimeEntry(token, rmUserId, rmPayload);
        action = "created";

        console.log('[RM Sync] RM entry created:', { rmEntryId: rmEntry.id });

        // Create synced entry record
        const newSyncedEntry = await prisma.rMSyncedEntry.create({
          data: {
            mappingId: mapping.id,
            aggregationDate: aggregate.date,
            rmEntryId: rmEntry.id,
            lastSyncedAt: new Date(),
            lastSyncedHash: aggregate.aggregateHash,
            syncVersion: 1,
          },
        });

        // Create component records
        await prisma.rMSyncedEntryComponent.createMany({
          data: aggregate.contributingEntries.map(entry => ({
            rmSyncedEntryId: newSyncedEntry.id,
            timesheetEntryId: entry.id,
            durationMinutes: entry.duration,
            isBillable: entry.isBillable,
            notes: entry.notes,
          })),
        });
      }

      // Update mapping last synced timestamp
      await prisma.rMProjectMapping.update({
        where: { id: mapping.id },
        data: { lastSyncedAt: new Date() },
      });

      success++;
      for (const entryId of aggregate.contributingEntryIds) {
        results.push({
          timesheetEntryId: entryId,
          status: "success",
          action,
          rmEntryId: rmEntry.id,
        });
      }

      // Add small delay to avoid rate limits (100ms between requests)
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      failed++;

      console.error('[RM Sync] Error syncing aggregate:', {
        projectId,
        date: dateStr,
        contributingEntries: aggregate.contributingEntryIds.length,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });

      let errorMessage = "Unknown error";
      if (error instanceof Error) {
       errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }

      // Special handling for specific errors
      if (error instanceof RMRateLimitError) {
        // Wait 2 seconds and retry once
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          // Retry the operation
          const existingSyncedEntry = await prisma.rMSyncedEntry.findUnique({
            where: {
              mappingId_aggregationDate: {
                mappingId: mapping.id,
                aggregationDate: aggregate.date,
              },
            },
          });

          const rmPayload = {
            assignable_id: mapping.rmProjectId,
            date: dateStr,
            hours: aggregate.totalHours,
            notes: aggregate.notes || undefined,
            task: mapBillableToTask(aggregate.isBillable),
          };

          let rmEntry;
          if (existingSyncedEntry) {
            rmEntry = await rmApi.updateTimeEntry(
              token,
              rmUserId,
              Number(existingSyncedEntry.rmEntryId),
              rmPayload
            );

            await prisma.rMSyncedEntry.update({
              where: { id: existingSyncedEntry.id },
              data: {
                lastSyncedAt: new Date(),
                lastSyncedHash: aggregate.aggregateHash,
                syncVersion: { increment: 1 },
              },
            });
          } else {
            rmEntry = await rmApi.createTimeEntry(token, rmUserId, rmPayload);

            const newSyncedEntry = await prisma.rMSyncedEntry.create({
              data: {
                mappingId: mapping.id,
                aggregationDate: aggregate.date,
                rmEntryId: rmEntry.id,
                lastSyncedAt: new Date(),
                lastSyncedHash: aggregate.aggregateHash,
                syncVersion: 1,
              },
            });

            await prisma.rMSyncedEntryComponent.createMany({
              data: aggregate.contributingEntries.map(entry => ({
                rmSyncedEntryId: newSyncedEntry.id,
                timesheetEntryId: entry.id,
                durationMinutes: entry.duration,
                isBillable: entry.isBillable,
                notes: entry.notes,
              })),
            });
          }

          // Retry succeeded
          failed--; // Undo the failed increment
          success++;
          for (const entryId of aggregate.contributingEntryIds) {
            results.push({
              timesheetEntryId: entryId,
              status: "success",
              action: existingSyncedEntry ? "updated" : "created",
              rmEntryId: rmEntry.id,
            });
          }
        } catch (retryError) {
          // Retry failed
          errorMessage = `Rate limited, retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
          for (const entryId of aggregate.contributingEntryIds) {
            results.push({
              timesheetEntryId: entryId,
              status: "failed",
              error: errorMessage,
            });
          }
        }
      } else if (error instanceof RMNotFoundError) {
        // RM project may have been deleted - mark mapping as disabled
        await prisma.rMProjectMapping.update({
          where: { id: mapping.id },
          data: { enabled: false },
        });

        errorMessage = "RM project not found - mapping disabled";
        for (const entryId of aggregate.contributingEntryIds) {
          results.push({
            timesheetEntryId: entryId,
            status: "failed",
            error: errorMessage,
          });
        }
      } else {
        for (const entryId of aggregate.contributingEntryIds) {
          results.push({
            timesheetEntryId: entryId,
            status: "failed",
            error: errorMessage,
          });
        }
      }
    }
  }

  // Determine final status
  let finalStatus: RMSyncStatus;
  if (failed === 0 && attempted > 0) {
    finalStatus = RMSyncStatus.COMPLETED;
  } else if (success > 0 && failed > 0) {
    finalStatus = RMSyncStatus.PARTIAL;
  } else if (failed > 0) {
    finalStatus = RMSyncStatus.FAILED;
  } else {
    finalStatus = RMSyncStatus.COMPLETED;
  }

  // Complete the sync
  await completeSync(
    syncLogId,
    finalStatus,
    {
      entriesAttempted: attempted,
      entriesSuccess: success,
      entriesFailed: failed,
      entriesSkipped: skipped,
    },
    failed > 0 ? `${failed} aggregates failed to sync` : undefined,
    failed > 0 ? {
      errors: results
        .filter((r) => r.status === "failed")
        .map((r) => ({ entryId: r.timesheetEntryId, error: r.error })),
    } : undefined
  );

    return {
      syncLogId,
      status: finalStatus,
      entriesAttempted: attempted,
      entriesSuccess: success,
      entriesFailed: failed,
      entriesSkipped: skipped,
      errors: results
        .filter((r) => r.status === "failed" && r.error)
        .map((r) => ({ entryId: r.timesheetEntryId, error: r.error! })),
    };
  } catch (catastrophicError) {
    // Catastrophic error occurred (e.g., database connection failure, schema mismatch)
    // Mark sync as FAILED to prevent stuck RUNNING state
    console.error('[RM Sync] Catastrophic error during sync execution:', catastrophicError);

    await completeSync(
      syncLogId,
      RMSyncStatus.FAILED,
      { entriesAttempted: 0, entriesSuccess: 0, entriesFailed: 0, entriesSkipped: 0 },
      catastrophicError instanceof Error ? catastrophicError.message : "Unknown error during sync execution",
      { catastrophicError: catastrophicError instanceof Error ? catastrophicError.stack : String(catastrophicError) }
    );

    // Re-throw to propagate to caller
    throw catastrophicError;
  }
}
