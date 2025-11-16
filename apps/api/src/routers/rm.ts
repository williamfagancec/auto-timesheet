/**
 * RM (Resource Management by Smartsheet) Integration Router
 * Handles connection management, project mapping, and time entry syncing
 */

import { router, protectedProcedure } from "../trpc.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "database";
import * as RMConnection from "../services/rm-connection.js";
import { rmApi } from "../services/rm-api.js";
import { suggestMatches, getAutoMapSuggestions } from "../services/rm-project-matching.js";
import { syncTimeEntries } from "../services/rm-sync.js";

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

const CreateMappingInput = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  rmProjectId: z.number().int().positive("RM Project ID must be positive"),
  rmProjectName: z.string().min(1, "RM Project name is required"),
  rmProjectCode: z.string().optional().nullable(),
});

const CreateBulkMappingsInput = z.array(CreateMappingInput);

const DeleteMappingInput = z.object({
  id: z.string().min(1, "Mapping ID is required"),
});

const SyncExecuteInput = z.object({
  weekStartDate: z.string().datetime(),
});

const SyncStatusInput = z.object({
  weekStartDate: z.string().datetime(),
});

const SyncHistoryInput = z.object({
  limit: z.number().int().min(1).max(50).default(10),
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

  /**
   * RM Projects
   */
  projects: router({
    /**
     * Get list of all RM projects
     * Fetches from RM API with pagination and returns only active projects
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      // Get user's RM connection
      const connection = await prisma.rMConnection.findUnique({
        where: { userId: ctx.user.id },
      });

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "RM connection not found - please connect your RM account first",
        });
      }

      try {
        // Decrypt token
        const token = await RMConnection.getDecryptedToken(ctx.user.id);

        // Fetch all projects from RM API
        const projects = await rmApi.fetchAllProjects(token);

        return projects.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code || null,
          clientName: p.client_name || null,
        }));
      } catch (error) {
        console.error("[RM] Failed to fetch projects:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to fetch RM projects",
        });
      }
    }),
  }),

  /**
   * Project Mappings
   */
  mappings: router({
    /**
     * List all project mappings for the authenticated user
     * Includes joined project and RM project details
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      const connection = await prisma.rMConnection.findUnique({
        where: { userId: ctx.user.id },
        include: {
          projectMappings: {
            include: {
              project: true,
            },
          },
        },
      });

      if (!connection) {
        return [];
      }

      return connection.projectMappings.map((mapping) => ({
        id: mapping.id,
        projectId: mapping.projectId,
        projectName: mapping.project.name,
        rmProjectId: mapping.rmProjectId,
        rmProjectName: mapping.rmProjectName,
        rmProjectCode: mapping.rmProjectCode || null,
        enabled: mapping.enabled,
        lastSyncedAt: mapping.lastSyncedAt?.toISOString() || null,
        createdAt: mapping.createdAt.toISOString(),
      }));
    }),

    /**
     * Get fuzzy match suggestions for unmapped projects
     * Returns map of projectId -> suggested RM project with confidence score
     */
    suggestMatches: protectedProcedure.query(async ({ ctx }) => {
      // Get user's connection
      const connection = await prisma.rMConnection.findUnique({
        where: { userId: ctx.user.id },
        include: {
          projectMappings: true,
        },
      });

      if (!connection) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "RM connection not found",
        });
      }

      // Get all user's projects
      const allProjects = await prisma.project.findMany({
        where: {
          userId: ctx.user.id,
          isArchived: false,
        },
        select: {
          id: true,
          name: true,
        },
      });

      // Filter to only unmapped projects
      const mappedProjectIds = new Set(connection.projectMappings.map((m) => m.projectId));
      const unmappedProjects = allProjects.filter((p) => !mappedProjectIds.has(p.id));

      if (unmappedProjects.length === 0) {
        return [];
      }

      // Fetch RM projects
      const token = await RMConnection.getDecryptedToken(ctx.user.id);
      const rmProjects = await rmApi.fetchAllProjects(token);

      // Filter to only unmapped RM projects
      const mappedRMProjectIds = new Set(connection.projectMappings.map((m) => m.rmProjectId));
      const availableRMProjects = rmProjects.filter((p) => !mappedRMProjectIds.has(p.id));

      // Generate suggestions
      const suggestions = suggestMatches(
        unmappedProjects,
        availableRMProjects.map((p) => ({ id: p.id, name: p.name, code: p.code || null })),
        0.65 // Minimum score threshold
      );

      // Convert to array format
      return Array.from(suggestions.values()).map((s) => ({
        localProjectId: s.localProjectId,
        localProjectName: s.localProjectName,
        rmProjectId: s.rmProjectId,
        rmProjectName: s.rmProjectName,
        rmProjectCode: s.rmProjectCode,
        score: s.score,
        reason: s.reason,
      }));
    }),

    /**
     * Get auto-map suggestions (high confidence matches >=0.85)
     */
    getAutoMapSuggestions: protectedProcedure.query(async ({ ctx }) => {
      // Reuse suggestMatches logic
      const connection = await prisma.rMConnection.findUnique({
        where: { userId: ctx.user.id },
        include: {
          projectMappings: true,
        },
      });

      if (!connection) {
        return [];
      }

      const allProjects = await prisma.project.findMany({
        where: {
          userId: ctx.user.id,
          isArchived: false,
        },
        select: {
          id: true,
          name: true,
        },
      });

      const mappedProjectIds = new Set(connection.projectMappings.map((m) => m.projectId));
      const unmappedProjects = allProjects.filter((p) => !mappedProjectIds.has(p.id));

      if (unmappedProjects.length === 0) {
        return [];
      }

      const token = await RMConnection.getDecryptedToken(ctx.user.id);
      const rmProjects = await rmApi.fetchAllProjects(token);

      const mappedRMProjectIds = new Set(connection.projectMappings.map((m) => m.rmProjectId));
      const availableRMProjects = rmProjects.filter((p) => !mappedRMProjectIds.has(p.id));

      const allSuggestions = suggestMatches(
        unmappedProjects,
        availableRMProjects.map((p) => ({ id: p.id, name: p.name, code: p.code || null })),
        0.65
      );

      // Filter to high confidence only
      const highConfidence = getAutoMapSuggestions(allSuggestions, 0.85);

      return highConfidence.map((s) => ({
        localProjectId: s.localProjectId,
        localProjectName: s.localProjectName,
        rmProjectId: s.rmProjectId,
        rmProjectName: s.rmProjectName,
        rmProjectCode: s.rmProjectCode,
        score: s.score,
        reason: s.reason,
      }));
    }),

    /**
     * Create a single project mapping
     */
    create: protectedProcedure
      .input(CreateMappingInput)
      .mutation(async ({ ctx, input }) => {
        // Get connection
        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "RM connection not found",
          });
        }

        // Verify project belongs to user
        const project = await prisma.project.findFirst({
          where: {
            id: input.projectId,
            userId: ctx.user.id,
          },
        });

        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }

        // Check for existing mappings (unique constraints)
        const existingByProject = await prisma.rMProjectMapping.findUnique({
          where: {
            connectionId_projectId: {
              connectionId: connection.id,
              projectId: input.projectId,
            },
          },
        });

        if (existingByProject) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This project is already mapped to an RM project",
          });
        }

        const existingByRM = await prisma.rMProjectMapping.findUnique({
          where: {
            connectionId_rmProjectId: {
              connectionId: connection.id,
              rmProjectId: input.rmProjectId,
            },
          },
        });

        if (existingByRM) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This RM project is already mapped to another project",
          });
        }

        // Create mapping
        const mapping = await prisma.rMProjectMapping.create({
          data: {
            connectionId: connection.id,
            projectId: input.projectId,
            rmProjectId: input.rmProjectId,
            rmProjectName: input.rmProjectName,
            rmProjectCode: input.rmProjectCode || null,
          },
        });

        return {
          id: mapping.id,
          projectId: mapping.projectId,
          rmProjectId: mapping.rmProjectId,
          rmProjectName: mapping.rmProjectName,
          rmProjectCode: mapping.rmProjectCode,
          createdAt: mapping.createdAt.toISOString(),
        };
      }),

    /**
     * Create multiple mappings at once (for auto-map feature)
     */
    createBulk: protectedProcedure
      .input(CreateBulkMappingsInput)
      .mutation(async ({ ctx, input }) => {
        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "RM connection not found",
          });
        }

        // Validate all projects belong to user
        const projectIds = input.map((m) => m.projectId);
        const projects = await prisma.project.findMany({
          where: {
            id: { in: projectIds },
            userId: ctx.user.id,
          },
        });

        if (projects.length !== projectIds.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "One or more projects not found",
          });
        }

        // Check for existing mappings
        const existingMappings = await prisma.rMProjectMapping.findMany({
          where: {
            connectionId: connection.id,
            OR: [
              { projectId: { in: projectIds } },
              { rmProjectId: { in: input.map((m) => m.rmProjectId) } },
            ],
          },
        });

        if (existingMappings.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${existingMappings.length} project(s) already mapped`,
          });
        }

        // Create all mappings in a transaction
        const mappings = await prisma.$transaction(
          input.map((mapping) =>
            prisma.rMProjectMapping.create({
              data: {
                connectionId: connection.id,
                projectId: mapping.projectId,
                rmProjectId: mapping.rmProjectId,
                rmProjectName: mapping.rmProjectName,
                rmProjectCode: mapping.rmProjectCode || null,
              },
            })
          )
        );

        return {
          created: mappings.length,
          mappings: mappings.map((m) => ({
            id: m.id,
            projectId: m.projectId,
            rmProjectId: m.rmProjectId,
            rmProjectName: m.rmProjectName,
          })),
        };
      }),

    /**
     * Delete a project mapping
     */
    delete: protectedProcedure
      .input(DeleteMappingInput)
      .mutation(async ({ ctx, input }) => {
        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (!connection) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "RM connection not found",
          });
        }

        // Verify mapping belongs to user's connection
        const mapping = await prisma.rMProjectMapping.findFirst({
          where: {
            id: input.id,
            connectionId: connection.id,
          },
        });

        if (!mapping) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Mapping not found",
          });
        }

        await prisma.rMProjectMapping.delete({
          where: { id: input.id },
        });

        return {
          success: true,
        };
      }),
  }),

  /**
   * Time Entry Sync
   */
  sync: router({
    /**
     * Execute sync for a specific week
     * Pushes timesheet entries to RM with change detection via SHA-256 hashing
     */
    execute: protectedProcedure
      .input(SyncExecuteInput)
      .mutation(async ({ ctx, input }) => {
        const weekStart = new Date(input.weekStartDate);

        // Validate Monday (day 1 in JavaScript Date)
        if (weekStart.getDay() !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "weekStartDate must be a Monday at midnight UTC",
          });
        }

        // Check rate limiting (max 2 syncs per minute)
        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (connection) {
          const recentSyncs = await prisma.rMSyncLog.count({
            where: {
              connectionId: connection.id,
              startedAt: { gte: new Date(Date.now() - 60 * 1000) }, // Last minute
            },
          });

          if (recentSyncs >= 2) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Please wait before syncing again (max 2 syncs per minute)",
            });
          }
        }

        try {
          const result = await syncTimeEntries(ctx.user.id, weekStart);

          return {
            success: true,
            ...result,
          };
        } catch (error) {
          console.error("[RM Sync] Failed:", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "Sync failed",
          });
        }
      }),

    /**
     * Get sync status for a specific week
     * Returns last sync time and count of synced entries
     */
    getStatus: protectedProcedure
      .input(SyncStatusInput)
      .query(async ({ ctx, input }) => {
        const weekStart = new Date(input.weekStartDate);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (!connection) {
          return null;
        }

        // Count synced entries for this week
        const syncedEntries = await prisma.rMSyncedEntry.findMany({
          where: {
            timesheetEntry: {
              userId: ctx.user.id,
              date: { gte: weekStart, lt: weekEnd },
            },
          },
          select: {
            lastSyncedAt: true,
          },
        });

        if (syncedEntries.length === 0) {
          return null;
        }

        const lastSync = syncedEntries.reduce((latest, entry) => {
          return entry.lastSyncedAt > latest ? entry.lastSyncedAt : latest;
        }, syncedEntries[0].lastSyncedAt);

        return {
          lastSyncAt: lastSync.toISOString(),
          syncedCount: syncedEntries.length,
        };
      }),

    /**
     * Get recent sync history
     * Returns log of recent sync operations with statistics
     */
    history: protectedProcedure
      .input(SyncHistoryInput)
      .query(async ({ ctx, input }) => {
        const connection = await prisma.rMConnection.findUnique({
          where: { userId: ctx.user.id },
        });

        if (!connection) {
          return [];
        }

        const logs = await prisma.rMSyncLog.findMany({
          where: { connectionId: connection.id },
          orderBy: { startedAt: "desc" },
          take: input.limit,
        });

        return logs.map((log) => ({
          id: log.id,
          status: log.status,
          entriesAttempted: log.entriesAttempted,
          entriesSuccess: log.entriesSuccess,
          entriesFailed: log.entriesFailed,
          entriesSkipped: log.entriesSkipped,
          errorMessage: log.errorMessage,
          startedAt: log.startedAt.toISOString(),
          completedAt: log.completedAt?.toISOString() || null,
        }));
      }),
  }),
});
