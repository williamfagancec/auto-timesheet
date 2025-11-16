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

/**
 * Custom error for sync-related issues
 */
export class RMSyncError extends Error {
  constructor(
    message: string,
    public code: "SYNC_IN_PROGRESS" | "NO_CONNECTION" | "SYNC_FAILED" | "INVALID_STATE"
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
