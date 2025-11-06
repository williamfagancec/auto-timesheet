import { router, protectedProcedure } from '../trpc.js'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'

export const timesheetRouter = router({
  /**
   * Get uncategorized calendar events for a date range
   * Returns events that don't have a timesheet entry or have one without a project assignment
   */
  getUncategorized: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date(input.startDate)
      const endDate = new Date(input.endDate)

      // Find all calendar events in the date range
      const events = await prisma.calendarEvent.findMany({
        where: {
          userId: ctx.user.id,
          isDeleted: false,
          startTime: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          entry: true, // Include timesheet entry if exists
        },
        orderBy: {
          startTime: 'asc',
        },
      })

      // Filter to only uncategorized events:
      // 1. No timesheet entry exists
      // 2. OR timesheet entry exists but has no project (projectId is null) and is not skipped
      const uncategorizedEvents = events.filter((event) => {
        if (!event.entry) {
          return true // No entry at all
        }
        // Has entry but no project and not skipped
        return !event.entry.projectId && !event.entry.isSkipped
      })

      return uncategorizedEvents
    }),

  /**
   * Bulk categorize events by creating or updating timesheet entries
   * Uses transaction to ensure atomicity
   */
  bulkCategorize: protectedProcedure
    .input(
      z.object({
        entries: z
          .array(
            z.object({
              eventId: z.string(),
              projectId: z.string(),
              notes: z.string().optional(),
            })
          )
          .min(1, 'At least one entry is required')
          .max(500, 'Cannot categorize more than 500 events at once'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate that all events belong to the user
      const events = await prisma.calendarEvent.findMany({
        where: {
          id: { in: input.entries.map((e) => e.eventId) },
          userId: ctx.user.id,
        },
      })

      if (events.length !== input.entries.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Some events not found or do not belong to you',
        })
      }

      // Validate that all projects belong to the user
      const projectIds = [...new Set(input.entries.map((e) => e.projectId))]
      const projects = await prisma.project.findMany({
        where: {
          id: { in: projectIds },
          userId: ctx.user.id,
        },
      })

      if (projects.length !== projectIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Some projects not found or do not belong to you',
        })
      }

      // Create event ID to event map for quick lookup
      const eventMap = new Map(events.map((e) => [e.id, e]))

      try {
        // Use transaction to ensure all entries are created/updated atomically
        const result = await prisma.$transaction(async (tx) => {
          const created = []
          const updated = []
          const errors = []

          for (const entry of input.entries) {
            try {
              const event = eventMap.get(entry.eventId)
              if (!event) {
                errors.push({ eventId: entry.eventId, error: 'Event not found' })
                continue
              }

              // Calculate duration in minutes
              const durationMs = event.endTime.getTime() - event.startTime.getTime()
              const durationMinutes = Math.round(durationMs / 60000)

              // Check if timesheet entry already exists
              const existingEntry = await tx.timesheetEntry.findUnique({
                where: { eventId: entry.eventId },
              })

              if (existingEntry) {
                // Update existing entry
                await tx.timesheetEntry.update({
                  where: { id: existingEntry.id },
                  data: {
                    projectId: entry.projectId,
                    notes: entry.notes,
                    isSkipped: false, // Un-skip if it was previously skipped
                  },
                })
                updated.push(entry.eventId)
              } else {
                // Create new entry
                await tx.timesheetEntry.create({
                  data: {
                    userId: ctx.user.id,
                    eventId: entry.eventId,
                    projectId: entry.projectId,
                    date: event.startTime,
                    duration: durationMinutes,
                    isManual: false,
                    isSkipped: false,
                    notes: entry.notes,
                  },
                })
                created.push(entry.eventId)
              }

              // Increment project use count
              await tx.project.update({
                where: { id: entry.projectId },
                data: {
                  useCount: { increment: 1 },
                  lastUsedAt: new Date(),
                },
              })
            } catch (error) {
              console.error(`Failed to process entry for event ${entry.eventId}:`, error)
              errors.push({
                eventId: entry.eventId,
                error: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          }

          return { created, updated, errors }
        })

        return {
          success: result.errors.length === 0,
          total: input.entries.length,
          created: result.created.length,
          updated: result.updated.length,
          failed: result.errors.length,
          errors: result.errors,
        }
      } catch (error) {
        console.error('Bulk categorize transaction failed:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to categorize events',
        })
      }
    }),

  /**
   * Mark an event as skipped (non-work time)
   * Creates a timesheet entry with isSkipped=true
   */
  skipEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify event exists and belongs to user
      const event = await prisma.calendarEvent.findUnique({
        where: { id: input.eventId },
      })

      if (!event) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Event not found',
        })
      }

      if (event.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to modify this event',
        })
      }

      // Calculate duration in minutes
      const durationMs = event.endTime.getTime() - event.startTime.getTime()
      const durationMinutes = Math.round(durationMs / 60000)

      // Check if timesheet entry already exists
      const existingEntry = await prisma.timesheetEntry.findUnique({
        where: { eventId: input.eventId },
      })

      if (existingEntry) {
        // Update existing entry to mark as skipped
        await prisma.timesheetEntry.update({
          where: { id: existingEntry.id },
          data: {
            isSkipped: true,
            projectId: null, // Clear project assignment
          },
        })
      } else {
        // Create new entry marked as skipped
        await prisma.timesheetEntry.create({
          data: {
            userId: ctx.user.id,
            eventId: input.eventId,
            date: event.startTime,
            duration: durationMinutes,
            isManual: false,
            isSkipped: true,
            projectId: null,
          },
        })
      }

      return { success: true }
    }),

  /**
   * Get timesheet entries for a date range (kept for backward compatibility)
   * Returns all timesheet entries with their associated events and projects
   */
  getEntries: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date(input.startDate)
      const endDate = new Date(input.endDate)

      const entries = await prisma.timesheetEntry.findMany({
        where: {
          userId: ctx.user.id,
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          event: true,
          project: true,
        },
        orderBy: {
          date: 'asc',
        },
      })

      return entries
    }),
})
