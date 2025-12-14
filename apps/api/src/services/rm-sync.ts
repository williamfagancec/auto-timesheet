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
import crypto from "crypto";

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

/**
 * Calculate hash for change detection
 * Hash includes: date + hours + notes to detect content changes
 */
function calculateEntryHash(date: Date, hours: number, notes: string | null): string {
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
  const content = `${dateStr}|${hours}|${notes || ""}`;
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Convert minutes to decimal hours (rounded to 2 decimal places)
 */
function minutesToDecimalHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

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
 */
export interface SyncPreviewResult {
  totalEntries: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  unmappedProjects: Array<{ projectId: string; projectName: string }>;
  entries: Array<{
    timesheetEntryId: string;
    projectName: string;
    date: string;
    hours: number;
    action: "create" | "update" | "skip";
    reason?: string;
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
 * Shows what would be created/updated/skipped
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
      rmSyncedEntry: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  console.log('[RM Sync] Found timesheet entries:', entries.length);

  const preview: SyncPreviewResult = {
    totalEntries: entries.length,
    toCreate: 0,
    toUpdate: 0,
    toSkip: 0,
    unmappedProjects: [],
    entries: [],
  };

  const unmappedProjectIds = new Set<string>();

  for (const entry of entries) {
    if (!entry.projectId || !entry.project) {
      preview.toSkip++;
      preview.entries.push({
        timesheetEntryId: entry.id,
        projectName: "No Project",
        date: entry.date.toISOString().split("T")[0],
        hours: minutesToDecimalHours(entry.duration),
        action: "skip",
        reason: "No project assigned",
      });
      continue;
    }

    // Check if hours are zero
    const hours = minutesToDecimalHours(entry.duration);
    if (hours === 0) {
      preview.toSkip++;
      preview.entries.push({
        timesheetEntryId: entry.id,
        projectName: entry.project.name,
        date: entry.date.toISOString().split("T")[0],
        hours,
        action: "skip",
        reason: "Zero hours",
      });
      continue;
    }

    // Check if project is mapped
    const mapping = mappingByProjectId.get(entry.projectId);
    if (!mapping) {
      if (!unmappedProjectIds.has(entry.projectId)) {
        unmappedProjectIds.add(entry.projectId);
        preview.unmappedProjects.push({
          projectId: entry.projectId,
          projectName: entry.project.name,
        });
      }
      preview.toSkip++;
      preview.entries.push({
        timesheetEntryId: entry.id,
        projectName: entry.project.name,
        date: entry.date.toISOString().split("T")[0],
        hours,
        action: "skip",
        reason: "Project not mapped to RM",
      });
      continue;
    }

    // Check if already synced
    if (entry.rmSyncedEntry) {
      // Calculate current hash
      const currentHash = calculateEntryHash(entry.date, hours, entry.notes);

      // If forceSync is enabled, always update synced entries (bypass hash check)
      if (forceSync) {
        preview.toUpdate++;
        preview.entries.push({
          timesheetEntryId: entry.id,
          projectName: entry.project.name,
          date: entry.date.toISOString().split("T")[0],
          hours,
          action: "update",
          reason: "Force sync enabled",
        });
      } else if (currentHash === entry.rmSyncedEntry.lastSyncedHash) {
        preview.toSkip++;
        preview.entries.push({
          timesheetEntryId: entry.id,
          projectName: entry.project.name,
          date: entry.date.toISOString().split("T")[0],
          hours,
          action: "skip",
          reason: "Already synced, no changes",
        });
      } else {
        preview.toUpdate++;
        preview.entries.push({
          timesheetEntryId: entry.id,
          projectName: entry.project.name,
          date: entry.date.toISOString().split("T")[0],
          hours,
          action: "update",
          reason: "Content changed since last sync",
        });
      }
    } else {
      preview.toCreate++;
      preview.entries.push({
        timesheetEntryId: entry.id,
        projectName: entry.project.name,
        date: entry.date.toISOString().split("T")[0],
        hours,
        action: "create",
      });
    }
  }

  return preview;
}

/**
 * Execute sync for timesheet entries in date range
 * This performs the actual API calls to RM
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
      rmSyncedEntry: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  const results: EntrySyncResult[] = [];
  let attempted = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Process each entry
  for (const entry of entries) {
    if (!entry.projectId) {
      skipped++;
      results.push({
        timesheetEntryId: entry.id,
        status: "skipped",
        error: "No project assigned",
      });
      continue;
    }

    // Check if hours are zero
    const hours = minutesToDecimalHours(entry.duration);
    if (hours === 0) {
      skipped++;
      results.push({
        timesheetEntryId: entry.id,
        status: "skipped",
        error: "Zero hours",
      });
      continue;
    }

    // Check if project is mapped
    const mapping = mappingByProjectId.get(entry.projectId);
    if (!mapping) {
      skipped++;
      results.push({
        timesheetEntryId: entry.id,
        status: "skipped",
        error: "Project not mapped to RM",
      });
      continue;
    }

    attempted++;

    try {
      // Calculate current hash
      const currentHash = calculateEntryHash(entry.date, hours, entry.notes);

      // Check if already synced
      if (entry.rmSyncedEntry) {
        // Check if content has changed (skip hash check if forceSync enabled)
        if (!forceSync && currentHash === entry.rmSyncedEntry.lastSyncedHash) {
          skipped++;
          attempted--; // Don't count no-change as attempted
          results.push({
            timesheetEntryId: entry.id,
            status: "skipped",
            action: "no_change",
            rmEntryId: Number(entry.rmSyncedEntry.rmEntryId),
          });
          continue;
        }

        // Update existing entry in RM
        try {
          const rmEntry = await rmApi.updateTimeEntry(
            token,
            rmUserId,
            Number(entry.rmSyncedEntry.rmEntryId),
            {
              assignable_id: mapping.rmProjectId,
              date: entry.date.toISOString().split("T")[0],
              hours,
              notes: entry.notes || undefined,
            }
          );

          // Update synced entry record
          await prisma.rMSyncedEntry.update({
            where: { id: entry.rmSyncedEntry.id },
            data: {
              lastSyncedAt: new Date(),
              lastSyncedHash: currentHash,
              syncVersion: { increment: 1 },
            },
          });

          success++;
          results.push({
            timesheetEntryId: entry.id,
            status: "success",
            action: "updated",
            rmEntryId: rmEntry.id,
          });
        } catch (updateError) {
          // If entry was deleted in RM (404), recreate it
          if (updateError instanceof RMNotFoundError) {
            console.log(`[RM Sync] Entry ${entry.rmSyncedEntry.rmEntryId} not found in RM (likely deleted), recreating...`);

            // Delete orphaned sync record
            await prisma.rMSyncedEntry.delete({
              where: { id: entry.rmSyncedEntry.id },
            });

            // Create new entry in RM
            const newRmEntry = await rmApi.createTimeEntry(
              token,
              rmUserId,
              {
                assignable_id: mapping.rmProjectId,
                date: entry.date.toISOString().split("T")[0],
                hours,
                notes: entry.notes || undefined,
              }
            );

            // Create new synced entry record
            await prisma.rMSyncedEntry.create({
              data: {
                mappingId: mapping.id,
                timesheetEntryId: entry.id,
                rmEntryId: newRmEntry.id,
                lastSyncedAt: new Date(),
                lastSyncedHash: currentHash,
                syncVersion: 1,
              },
            });

            // Update mapping last synced timestamp
            await prisma.rMProjectMapping.update({
              where: { id: mapping.id },
              data: { lastSyncedAt: new Date() },
            });

            success++;
            results.push({
              timesheetEntryId: entry.id,
              status: "success",
              action: "created", // Mark as created since we recreated it
              rmEntryId: newRmEntry.id,
            });

            console.log(`[RM Sync] Successfully recreated entry in RM with new ID ${newRmEntry.id}`);
          } else {
            // Re-throw other errors to be handled by outer catch
            throw updateError;
          }
        }
      } else {
        // Create new entry in RM
        console.log('[RM Sync] Creating RM entry:', {
          userId: connection.rmUserId,
          projectId: mapping.rmProjectId,
          date: entry.date.toISOString().split("T")[0],
          hours,
          timesheetEntryId: entry.id,
        });

        const rmEntry = await rmApi.createTimeEntry(
          token,
          rmUserId,
          {
            assignable_id: mapping.rmProjectId,
            date: entry.date.toISOString().split("T")[0],
            hours,
            notes: entry.notes || undefined,
          }
        );

        console.log('[RM Sync] RM entry created:', { rmEntryId: rmEntry.id, rmEntry });

        // Create synced entry record
        console.log('[RM Sync] Creating RMSyncedEntry record:', {
          mappingId: mapping.id,
          timesheetEntryId: entry.id,
          rmEntryId: rmEntry.id,
          rmEntryType: typeof rmEntry.id,
        });

        try {
          await prisma.rMSyncedEntry.create({
            data: {
              mappingId: mapping.id,
              timesheetEntryId: entry.id,
              rmEntryId: rmEntry.id,
              lastSyncedAt: new Date(),
              lastSyncedHash: currentHash,
              syncVersion: 1,
            },
          });
        } catch (dbError) {
          if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === 'P2002') {
            console.warn(`[RM Sync] Attempted to create a duplicate RMSyncedEntry for timesheetEntryId ${entry.id}. This may indicate a duplicate entry was created in RM. Recovering by updating the existing record.`);
            // The record already exists. This can happen if a previous sync failed after creating the RM entry but before creating the local one.
            // We'll update the existing record with the new RM entry details. This is safer than failing the sync.
            await prisma.rMSyncedEntry.update({
              where: { timesheetEntryId: entry.id },
              data: {
                rmEntryId: rmEntry.id, // The new one we just created in RM
                lastSyncedAt: new Date(),
                lastSyncedHash: currentHash,
                syncVersion: { increment: 1 },
                mappingId: mapping.id,
              },
            });
          } else {
            // Re-throw other database errors
            throw dbError;
          }
        }

        console.log('[RM Sync] RMSyncedEntry created successfully');

        // Update mapping last synced timestamp
        await prisma.rMProjectMapping.update({
          where: { id: mapping.id },
          data: { lastSyncedAt: new Date() },
        });

        success++;
        results.push({
          timesheetEntryId: entry.id,
          status: "success",
          action: "created",
          rmEntryId: rmEntry.id,
        });
      }

      // Add small delay to avoid rate limits (100ms between requests)
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      failed++;

      console.error('[RM Sync] Error syncing entry:', {
        timesheetEntryId: entry.id,
        projectId: entry.projectId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorDetails: error,
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
          const currentHash = calculateEntryHash(entry.date, hours, entry.notes);

          if (entry.rmSyncedEntry) {
            try {
              await rmApi.updateTimeEntry(
                token,
                rmUserId,
                Number(entry.rmSyncedEntry.rmEntryId),
                {
                  assignable_id: mapping.rmProjectId,
                  date: entry.date.toISOString().split("T")[0],
                  hours,
                  notes: entry.notes || undefined,
                }
              );

              await prisma.rMSyncedEntry.update({
                where: { id: entry.rmSyncedEntry.id },
                data: {
                  lastSyncedAt: new Date(),
                  lastSyncedHash: currentHash,
                  syncVersion: { increment: 1 },
                },
              });
            } catch (retryUpdateError) {
              // If entry was deleted in RM (404), recreate it
              if (retryUpdateError instanceof RMNotFoundError) {
                console.log(`[RM Sync] Retry: Entry ${entry.rmSyncedEntry.rmEntryId} not found in RM, recreating...`);

                // Delete orphaned sync record
                await prisma.rMSyncedEntry.delete({
                  where: { id: entry.rmSyncedEntry.id },
                });

                // Create new entry in RM
                const newRmEntry = await rmApi.createTimeEntry(
                  token,
                  rmUserId,
                  {
                    assignable_id: mapping.rmProjectId,
                    date: entry.date.toISOString().split("T")[0],
                    hours,
                    notes: entry.notes || undefined,
                  }
                );

                // Create new synced entry record
                await prisma.rMSyncedEntry.create({
                  data: {
                    mappingId: mapping.id,
                    timesheetEntryId: entry.id,
                    rmEntryId: newRmEntry.id,
                    lastSyncedAt: new Date(),
                    lastSyncedHash: currentHash,
                    syncVersion: 1,
                  },
                });

                console.log(`[RM Sync] Retry: Successfully recreated entry with new ID ${newRmEntry.id}`);
              } else {
                // Re-throw other errors
                throw retryUpdateError;
              }
            }
          } else {
            const rmEntry = await rmApi.createTimeEntry(
              token,
              connection.rmUserId,
              {
                assignable_id: mapping.rmProjectId,
                date: entry.date.toISOString().split("T")[0],
                hours,
                notes: entry.notes || undefined,
              }
            );

            await prisma.rMSyncedEntry.create({
              data: {
                mappingId: mapping.id,
                timesheetEntryId: entry.id,
                rmEntryId: rmEntry.id,
                lastSyncedAt: new Date(),
                lastSyncedHash: currentHash,
                syncVersion: 1,
              },
            });
          }

          // Retry succeeded
          failed--; // Undo the failed increment
          success++;
          results.push({
            timesheetEntryId: entry.id,
            status: "success",
            action: entry.rmSyncedEntry ? "updated" : "created",
          });
        } catch (retryError) {
          // Retry failed
          errorMessage = `Rate limited, retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
          results.push({
            timesheetEntryId: entry.id,
            status: "failed",
            error: errorMessage,
          });
        }
      } else if (error instanceof RMNotFoundError) {
        // RM project may have been deleted - mark mapping as disabled
        await prisma.rMProjectMapping.update({
          where: { id: mapping.id },
          data: { enabled: false },
        });

        errorMessage = "RM project not found - mapping disabled";
        results.push({
          timesheetEntryId: entry.id,
          status: "failed",
          error: errorMessage,
        });
      } else {
        results.push({
          timesheetEntryId: entry.id,
          status: "failed",
          error: errorMessage,
        });
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
    failed > 0 ? `${failed} entries failed to sync` : undefined,
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
