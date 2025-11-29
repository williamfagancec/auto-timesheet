import { router, protectedProcedure } from '../trpc.js'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'

/**
 * Get or create user project defaults
 * Returns the default billable status and phase for a user
 */
async function getOrCreateUserDefaults(tx: any, userId: string) {
  let defaults = await tx.userProjectDefaults.findUnique({
    where: { userId },
  })

  if (!defaults) {
    defaults = await tx.userProjectDefaults.create({
      data: {
        userId,
        isBillable: true,
        phase: null,
      },
    })
  }

  return defaults
}

export const timesheetRouter = router({
  /**
   * Get weekly grid data with aggregated hours per project per day
   * Returns structured data for the weekly timesheet grid view
   */
  getWeeklyGrid: protectedProcedure
    .input(
      z.object({
        weekStartDate: z.string().datetime(), // Monday at midnight UTC
      })
    )
    .query(async ({ ctx, input }) => {
      const weekStart = new Date(input.weekStartDate)
      const dayOfWeek = weekStart.getDay()
      if (dayOfWeek !== 1) { // 1 = Monday
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'weekStartDate must be a Monday at midnight UTC',
        })
      }
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7) // Add 7 days

      // Get all timesheet entries for the week (excluding skipped)
      const entries = await prisma.timesheetEntry.findMany({
        where: {
          userId: ctx.user.id,
          date: {
            gte: weekStart,
            lt: weekEnd,
          },
          isSkipped: false,
        },
        include: {
          project: true,
        },
      })

      // Get all active projects for the user (in order they were created)
      const allProjects = await prisma.project.findMany({
        where: {
          userId: ctx.user.id,
          isArchived: false,
        },
        orderBy: {
          createdAt: 'asc',
        },
      })

      // Helper: Get day of week (0 = Monday, 6 = Sunday)
      const getDayOfWeek = (date: Date): number => {
        const day = date.getDay()
        return day === 0 ? 6 : day - 1 // Convert Sunday=0 to Sunday=6
      }

      // Helper: Day names
      const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

      // Build project data structure
      const projectsData = allProjects.map((project) => {
        const dailyHours: Record<string, number> = {
          mon: 0,
          tue: 0,
          wed: 0,
          thu: 0,
          fri: 0,
          sat: 0,
          sun: 0,
        }

        const notes: Record<string, string | undefined> = {
          mon: undefined,
          tue: undefined,
          wed: undefined,
          thu: undefined,
          fri: undefined,
          sat: undefined,
          sun: undefined,
        }

        // Track event-sourced hours separately for visual indicators
        const eventHours: Record<string, number> = {
          mon: 0,
          tue: 0,
          wed: 0,
          thu: 0,
          fri: 0,
          sat: 0,
          sun: 0,
        }

        const manualHours: Record<string, number> = {
          mon: 0,
          tue: 0,
          wed: 0,
          thu: 0,
          fri: 0,
          sat: 0,
          sun: 0,
        }

        // Aggregate entries for this project
        const projectEntries = entries.filter((e) => e.projectId === project.id)

        projectEntries.forEach((entry) => {
          const dayIndex = getDayOfWeek(entry.date)
          const dayName = dayNames[dayIndex]
          const hours = entry.duration / 60 // Convert minutes to hours

          dailyHours[dayName] = (dailyHours[dayName] || 0) + hours

          // Track event vs manual hours
          if (entry.eventId) {
            eventHours[dayName] = (eventHours[dayName] || 0) + hours
          } else {
            manualHours[dayName] = (manualHours[dayName] || 0) + hours
          }

          // Concatenate notes if multiple entries exist
          if (entry.notes) {
            if (notes[dayName]) {
              notes[dayName] += `\n${entry.notes}`
            } else {
              notes[dayName] = entry.notes
            }
          }
        })

        // Calculate weekly total
        const weeklyTotal = Object.values(dailyHours).reduce((sum, hours) => sum + hours, 0)

        return {
          id: project.id,
          name: project.name,
          dailyHours,
          weeklyTotal,
          notes,
          eventHours, // Hours from categorized calendar events
          manualHours, // Hours from manual entries/adjustments
        }
      })

      // Calculate daily totals across all projects
      const dailyTotals = {
        mon: 0,
        tue: 0,
        wed: 0,
        thu: 0,
        fri: 0,
        sat: 0,
        sun: 0,
      }

      entries.forEach((entry) => {
        if (entry.projectId) {
          // Only count categorized entries
          const dayIndex = getDayOfWeek(entry.date)
          const dayName = dayNames[dayIndex]
          const hours = entry.duration / 60

          dailyTotals[dayName] = (dailyTotals[dayName] || 0) + hours
        }
      })

      // Calculate uncategorized hours (entries without projectId)
      const uncategorizedHours = {
        mon: 0,
        tue: 0,
        wed: 0,
        thu: 0,
        fri: 0,
        sat: 0,
        sun: 0,
      }

      entries.forEach((entry) => {
        if (!entry.projectId) {
          const dayIndex = getDayOfWeek(entry.date)
          const dayName = dayNames[dayIndex]
          const hours = entry.duration / 60

          uncategorizedHours[dayName] = (uncategorizedHours[dayName] || 0) + hours
        }
      })

      return {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        projects: projectsData,
        dailyTotals,
        uncategorizedHours,
        targetHoursPerDay: 7.5,
      }
    }),

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
              isBillable: z.boolean().optional(),
              phase: z.string().optional(),
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

          // Get user defaults once at the start
          const userDefaults = await getOrCreateUserDefaults(tx, ctx.user.id)

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

              // Use provided values or fall back to user defaults for billable only
              // Phase should NOT use defaults - it should remain null unless explicitly provided
              const isBillable = entry.isBillable ?? userDefaults.isBillable
              const phase = entry.phase ?? null

              // Check if timesheet entry already exists
              const existingEntry = await tx.timesheetEntry.findUnique({
                where: { eventId: entry.eventId },
              })

              if (existingEntry) {
                // If project is changing, clean up any manual adjustment entries from the old project/date
                if (existingEntry.projectId !== entry.projectId && existingEntry.projectId) {
                  const dateStart = new Date(event.startTime)
                  dateStart.setHours(0, 0, 0, 0)
                  const dateEnd = new Date(dateStart)
                  dateEnd.setDate(dateEnd.getDate() + 1)

                  await tx.timesheetEntry.deleteMany({
                    where: {
                      userId: ctx.user.id,
                      projectId: existingEntry.projectId,
                      date: {
                        gte: dateStart,
                        lt: dateEnd,
                      },
                      isManual: true,
                      eventId: null,
                    },
                  })
                }

                // Update existing entry
                await tx.timesheetEntry.update({
                  where: { id: existingEntry.id },
                  data: {
                    projectId: entry.projectId,
                    notes: entry.notes,
                    isSkipped: false, // Un-skip if it was previously skipped
                    isBillable,
                    phase,
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
                    isBillable,
                    phase,
                  },
                })
                created.push(entry.eventId)
              }

              // Update user defaults only for billable (not phase)
              // Phase should remain event-specific and not be saved to user defaults
              if (entry.isBillable !== undefined) {
                await tx.userProjectDefaults.update({
                  where: { userId: ctx.user.id },
                  data: { isBillable: entry.isBillable },
                })
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

  /**
   * Update hours for a specific project/day cell
   * Creates or updates a manual adjustment entry to reach the target hours
   */
  updateCell: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        date: z.string().datetime(), // Day at midnight UTC
        hours: z.number().min(0).max(24),
        notes: z.string().max(500).optional(),
        isBillable: z.boolean().optional(),
        phase: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project exists and belongs to user
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
      })

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        })
      }

      if (project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to modify this project',
        })
      }

      const dateStart = new Date(input.date)
      const dateEnd = new Date(dateStart)
      dateEnd.setDate(dateEnd.getDate() + 1)

      const targetMinutes = Math.round(input.hours * 60)

      // Get all existing entries for this project/day
      const existingEntries = await prisma.timesheetEntry.findMany({
        where: {
          userId: ctx.user.id,
          projectId: input.projectId,
          date: {
            gte: dateStart,
            lt: dateEnd,
          },
          isSkipped: false,
        },
        include: {
          event: true,
        },
      })

      // Find event-based and manual entries
      const eventEntries = existingEntries.filter((e) => e.eventId !== null)
      const manualEntries = existingEntries.filter((e) => e.isManual && e.eventId === null)

      const eventMinutes = eventEntries.reduce((sum, e) => sum + e.duration, 0)
      const adjustmentMinutes = targetMinutes - eventMinutes

      try {
        await prisma.$transaction(async (tx) => {
          // Get user defaults
          const userDefaults = await getOrCreateUserDefaults(tx, ctx.user.id)

          // Use provided values or fall back to user defaults for billable only
          // Phase should NOT use defaults - it should remain null unless explicitly provided
          const isBillable = input.isBillable ?? userDefaults.isBillable
          const phase = input.phase ?? null

          // Delete all existing manual adjustment entries for this day/project
          await tx.timesheetEntry.deleteMany({
            where: {
              id: { in: manualEntries.map((e) => e.id) },
            },
          })

          // Create new manual adjustment entry if needed (non-zero hours)
          if (targetMinutes > 0) {
            // If there are event entries, create adjustment entry for the delta
            // If no event entries, create manual entry for full amount
            if (eventEntries.length > 0 && adjustmentMinutes !== 0) {
              await tx.timesheetEntry.create({
                data: {
                  userId: ctx.user.id,
                  projectId: input.projectId,
                  date: dateStart,
                  duration: adjustmentMinutes,
                  isManual: true,
                  notes: input.notes,
                  isBillable,
                  phase,
                },
              })
            } else if (eventEntries.length === 0) {
              // No events, create full manual entry
              await tx.timesheetEntry.create({
                data: {
                  userId: ctx.user.id,
                  projectId: input.projectId,
                  date: dateStart,
                  duration: targetMinutes,
                  isManual: true,
                  notes: input.notes,
                  isBillable,
                  phase,
                },
              })
            } else if (input.notes || input.isBillable !== undefined || input.phase !== undefined) {
              // Hours match events but notes/billable/phase provided - update first event entry
              if (eventEntries[0]) {
                const updateData: { notes?: string; isBillable?: boolean; phase?: string | null } = {}
                if (input.notes) updateData.notes = input.notes
                if (input.isBillable !== undefined) updateData.isBillable = input.isBillable
                if (input.phase !== undefined) updateData.phase = input.phase || null
                await tx.timesheetEntry.update({
                  where: { id: eventEntries[0].id },
                  data: updateData,
                })
              }
            }
          } else if ((input.notes || input.isBillable !== undefined || input.phase !== undefined) && eventEntries.length > 0) {
            // Zero hours but notes/billable/phase provided - update first event entry
            const updateData: { notes?: string; isBillable?: boolean; phase?: string | null } = {}
            if (input.notes) updateData.notes = input.notes
            if (input.isBillable !== undefined) updateData.isBillable = input.isBillable
            if (input.phase !== undefined) updateData.phase = input.phase || null
            await tx.timesheetEntry.update({
              where: { id: eventEntries[0].id },
              data: updateData,
            })
          }

          // Update user defaults only for billable (not phase)
          // Phase should remain event-specific and not be saved to user defaults
          if (input.isBillable !== undefined) {
            await tx.userProjectDefaults.update({
              where: { userId: ctx.user.id },
              data: { isBillable: input.isBillable },
            })
          }

          // Increment project usage tracking
          await tx.project.update({
            where: { id: input.projectId },
            data: {
              useCount: { increment: 1 },
              lastUsedAt: new Date(),
            },
          })
        })

        return {
          success: true,
          updatedHours: input.hours,
        }
      } catch (error) {
        console.error('Failed to update cell:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update timesheet cell',
        })
      }
    }),

  /**
   * Reset timesheet to match categorized events only
   * Removes all manual entries and adjustments, keeping only event-sourced entries
   */
  resetToEvents: protectedProcedure
    .input(
      z.object({
        weekStartDate: z.string().datetime(), // Monday at midnight UTC
      })
    )
    .mutation(async ({ ctx, input }) => {
      const weekStart = new Date(input.weekStartDate)
      const dayOfWeek = weekStart.getDay()
      if (dayOfWeek !== 1) { // 1 = Monday
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'weekStartDate must be a Monday at midnight UTC',
        })
      }
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 7) // Add 7 days

      try {
        // Delete all manual entries (no eventId or isManual=true) for the week
        const result = await prisma.timesheetEntry.deleteMany({
          where: {
            userId: ctx.user.id,
            date: {
              gte: weekStart,
              lt: weekEnd,
            },
            OR: [
              { isManual: true },
              { eventId: null },
            ],
          },
        })

        return {
          success: true,
          deletedCount: result.count,
        }
      } catch (error) {
        console.error('Failed to reset timesheet to events:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to reset timesheet',
        })
      }
    }),

  /**
   * Assign uncategorized event(s) to a project
   * Updates existing timesheet entries or creates new ones
   */
  assignEventToProject: protectedProcedure
    .input(
      z.object({
        eventIds: z.array(z.string()).min(1).max(100),
        projectId: z.string(),
        isBillable: z.boolean().optional(),
        phase: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project exists and belongs to user
      const project = await prisma.project.findUnique({
        where: { id: input.projectId },
      })

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        })
      }

      if (project.userId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this project',
        })
      }

      // Get all calendar events
      const events = await prisma.calendarEvent.findMany({
        where: {
          id: { in: input.eventIds },
          userId: ctx.user.id,
        },
      })

      if (events.length !== input.eventIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Some events not found or do not belong to you',
        })
      }

      try {
        await prisma.$transaction(async (tx) => {
          // Get user defaults
          const userDefaults = await getOrCreateUserDefaults(tx, ctx.user.id)

          // Use provided values or fall back to user defaults for billable only
          // Phase should NOT use defaults - it should remain null unless explicitly provided
          const isBillable = input.isBillable ?? userDefaults.isBillable
          const phase = input.phase ?? null

          for (const event of events) {
            const durationMinutes = Math.round(
              (event.endTime.getTime() - event.startTime.getTime()) / 60000
            )

            // Check if timesheet entry already exists for this event
            const existingEntry = await tx.timesheetEntry.findUnique({
              where: { eventId: event.id },
            })

            if (existingEntry) {
              // If project is changing, clean up any manual adjustment entries from the old project/date
              if (existingEntry.projectId !== input.projectId && existingEntry.projectId) {
                const dateStart = new Date(event.startTime)
                dateStart.setHours(0, 0, 0, 0)
                const dateEnd = new Date(dateStart)
                dateEnd.setDate(dateEnd.getDate() + 1)

                await tx.timesheetEntry.deleteMany({
                  where: {
                    userId: ctx.user.id,
                    projectId: existingEntry.projectId,
                    date: {
                      gte: dateStart,
                      lt: dateEnd,
                    },
                    isManual: true,
                    eventId: null,
                  },
                })
              }

              // Update existing entry with new project
              await tx.timesheetEntry.update({
                where: { id: existingEntry.id },
                data: {
                  projectId: input.projectId,
                  isSkipped: false,
                  isBillable,
                  phase,
                },
              })
            } else {
              // Create new entry
              await tx.timesheetEntry.create({
                data: {
                  userId: ctx.user.id,
                  eventId: event.id,
                  projectId: input.projectId,
                  date: event.startTime,
                  duration: durationMinutes,
                  isManual: false,
                  isSkipped: false,
                  isBillable,
                  phase,
                },
              })
            }
          }

          // Update user defaults only for billable (not phase)
          // Phase should remain event-specific and not be saved to user defaults
          if (input.isBillable !== undefined) {
            await tx.userProjectDefaults.update({
              where: { userId: ctx.user.id },
              data: { isBillable: input.isBillable },
            })
          }

          // Increment project usage
          await tx.project.update({
            where: { id: input.projectId },
            data: {
              useCount: { increment: events.length },
              lastUsedAt: new Date(),
            },
          })
        })

        return {
          success: true,
          assignedCount: events.length,
        }
      } catch (error) {
        console.error('Failed to assign events to project:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to assign events to project',
        })
      }
    }),
})
