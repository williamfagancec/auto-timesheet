/**
 * RM (Resource Management by Smartsheet) Integration Router
 * Handles connection management, project mapping, and time entry syncing
 */

import { router, protectedProcedure } from "../trpc.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as RMConnection from "../services/rm-connection.js";

/**
 * Zod Schemas
 */
const CreateRMConnectionInput = z.object({
  apiToken: z
    .string()
    .min(1, "API token is required")
    .max(500, "API token is too long")
    .trim(),
});

/**
 * RM Router
 */
export const rmRouter = router({
  /**
   * Connection Management
   */
  connection: router({
    /**
     * Create or update RM connection
     * Validates token with RM API and stores encrypted credentials
     */
    create: protectedProcedure
      .input(CreateRMConnectionInput)
      .mutation(async ({ ctx, input }) => {
        try {
          const connection = await RMConnection.createConnection(
            ctx.user.id,
            input.apiToken
          );

          return {
            success: true,
            connection: {
              id: connection.id,
              rmUserId: connection.rmUserId,
              rmUserEmail: connection.rmUserEmail,
              rmUserName: connection.rmUserName,
              createdAt: connection.createdAt.toISOString(),
            },
          };
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error
                ? error.message
                : "Failed to create RM connection",
          });
        }
      }),

    /**
     * Get current RM connection
     * Returns null if no connection exists
     */
    get: protectedProcedure.query(async ({ ctx }) => {
      const connection = await RMConnection.getConnection(ctx.user.id);

      if (!connection) {
        return null;
      }

      return {
        id: connection.id,
        rmUserId: connection.rmUserId,
        rmUserEmail: connection.rmUserEmail,
        rmUserName: connection.rmUserName,
        autoSyncEnabled: connection.autoSyncEnabled,
        lastSyncAt: connection.lastSyncAt?.toISOString() || null,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
      };
    }),

    /**
     * Validate current RM connection
     * Checks if token is still valid with RM API
     */
    validate: protectedProcedure.query(async ({ ctx }) => {
      const isValid = await RMConnection.validateConnection(ctx.user.id);

      return {
        isValid,
      };
    }),

    /**
     * Delete RM connection
     * Removes connection and all related data (cascades to mappings, synced entries, logs)
     */
    delete: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        await RMConnection.deleteConnection(ctx.user.id);

        return {
          success: true,
        };
      } catch (error) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "RM connection not found",
        });
      }
    }),
  }),
});
