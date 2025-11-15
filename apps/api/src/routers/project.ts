import { router, protectedProcedure } from '../trpc.js'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'

const projectNameSchema = z
  .string()
  .transform((val) => val.replace(/<[^>]*>/g, '').trim())
  .pipe(
    z
      .string()
      .min(1, 'Project name cannot be empty')
      .max(100, 'Project name must be less than 100 characters')
      .regex(/\S/, 'Project name cannot be only whitespace')
  )

export const projectRouter = router({
  /**
   * List projects with optional filtering and sorting
   */
  list: protectedProcedure
    .input(
      z.object({
        includeArchived: z.boolean().optional().default(false),
        search: z.string().optional(),
        sortBy: z.enum(['name', 'lastUsedAt', 'useCount', 'hours30Days']).optional().default('lastUsedAt'),
        limit: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const whereClause: any = {
        userId: ctx.user.id,
      }

      // Filter archived projects
      if (!input.includeArchived) {
        whereClause.isArchived = false
      }

      // Case-insensitive search on project name
      if (input.search) {
        whereClause.name = {
          contains: input.search,
          mode: 'insensitive',
        }
      }

      // Calculate date 30 days ago at midnight (start of day)
      const now = new Date()
      const thirtyDaysAgo = new Date(now)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      thirtyDaysAgo.setHours(0, 0, 0, 0) // Set to start of day

      // Calculate end date (today at end of day) to include today's entries
      const todayEnd = new Date(now)
      todayEnd.setHours(23, 59, 59, 999) // Set to end of today

      // Get all projects
      const projects = await prisma.project.findMany({
        where: whereClause,
        take: input.limit,
      })

      // Get all project IDs
      const projectIds = projects.map((p) => p.id)

      // Get all timesheet entries for these projects in the past 30 days in a single query
      // Only query if we have projects to avoid empty IN clause
      const entries = projectIds.length > 0
        ? await prisma.timesheetEntry.findMany({
            where: {
              userId: ctx.user.id,
              projectId: {
                in: projectIds,
              },
              date: {
                gte: thirtyDaysAgo,
                lte: todayEnd,
              },
              isSkipped: false,
            },
            select: {
              projectId: true,
              duration: true,
            },
          })
        : []

      // Calculate total hours per project
      const hoursByProject = new Map<string, number>()
      entries.forEach((entry) => {
        if (entry.projectId) {
          const current = hoursByProject.get(entry.projectId) || 0
          hoursByProject.set(entry.projectId, current + entry.duration)
        }
      })

      // Add hours30Days to each project
      const projectsWithHours = projects.map((project) => {
        const totalMinutes = hoursByProject.get(project.id) || 0
        // Convert minutes to hours (round to 2 decimal places)
        const hours30Days = Math.round((totalMinutes / 60) * 100) / 100
        return {
          ...project,
          hours30Days,
        }
      })

      // Determine sort order
      let sortedProjects = [...projectsWithHours]
      if (input.sortBy === 'name') {
        sortedProjects.sort((a, b) => a.name.localeCompare(b.name))
      } else if (input.sortBy === 'lastUsedAt') {
        sortedProjects.sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
      } else if (input.sortBy === 'useCount') {
        sortedProjects.sort((a, b) => b.useCount - a.useCount)
      } else if (input.sortBy === 'hours30Days') {
        sortedProjects.sort((a, b) => b.hours30Days - a.hours30Days)
      }

      return sortedProjects
    }),

  /**
   * Create a new project with validation
   */
  create: protectedProcedure
    .input(
      z.object({
        name: projectNameSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate project name (case-insensitive)
      const existingProject = await prisma.project.findFirst({
        where: {
          userId: ctx.user.id,
          name: {
            equals: input.name,
            mode: 'insensitive',
          },
        },
      })

      if (existingProject) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Project "${input.name}" already exists`,
        })
      }

      // Create project with initial usage tracking
      const project = await prisma.project.create({
        data: {
          userId: ctx.user.id,
          name: input.name,
          useCount: 1,
          lastUsedAt: new Date(),
        },
      })

      return project
    }),

  /**
   * Update project name with ownership verification
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: projectNameSchema,
      })
    )
    
    .mutation(async ({ ctx, input }) => {
      // Verify project exists and belongs to user
      const project = await prisma.project.findUnique({
        where: { id: input.id },
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

      // Check for duplicate name (excluding current project)
      const duplicateProject = await prisma.project.findFirst({
        where: {
          userId: ctx.user.id,
          name: {
            equals: input.name,
            mode: 'insensitive',
          },
          id: {
            not: input.id,
          },
        },
      })

      if (duplicateProject) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Project "${input.name}" already exists`,
        })
      }

      // Update project name
      const updatedProject = await prisma.project.update({
        where: { id: input.id },
        data: { name: input.name },
      })

      return updatedProject
    }),

  /**
   * Archive or unarchive a project
   */
  archive: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        isArchived: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project exists and belongs to user
      const project = await prisma.project.findUnique({
        where: { id: input.id },
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

      // Update archive status
      const updatedProject = await prisma.project.update({
        where: { id: input.id },
        data: { isArchived: input.isArchived },
      })

      return updatedProject
    }),

  /**
   * Increment project use count and update last used timestamp
   * Called when a project is assigned to a timesheet entry
   */
  incrementUse: protectedProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project exists and belongs to user
      const project = await prisma.project.findUnique({
        where: { id: input.id },
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

      // Update usage tracking
      await prisma.project.update({
        where: { id: input.id },
        data: {
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      })

      return { success: true }
    }),

  /**
   * Get AI-generated project suggestions for an event
   * Currently returns empty array (stub for SCL)
   * Future: Implement rule-based categorization using CategoryRule model
   */
  getSuggestions: protectedProcedure
    .input(
      z.object({
        eventTitle: z.string(),
        attendees: z.array(z.string()).optional(),
        calendarId: z.string().optional(),
      })
    )
    .query(async () => {
      // TODO: Implement AI categorization based on CategoryRule model
      // For SCL: return empty array to avoid false positives
      // Future: Query CategoryRule for matches based on:
      // - Event title keywords (input.eventTitle)
      // - Attendee email patterns (input.attendees)
      // - Calendar ID (input.calendarId)
      // - Sort by confidence score (accuracy field)
      // - Filter by userId (ctx.user.id)
      return []
    }),

  /**
   * Get user project defaults (billable status and phase)
   * Returns the most recently used values for new entries
   */
  getDefaults: protectedProcedure.query(async ({ ctx }) => {
    const defaults = await prisma.userProjectDefaults.findUnique({
      where: { userId: ctx.user.id },
    })

    // Return defaults or create and return initial defaults
    if (!defaults) {
      const newDefaults = await prisma.userProjectDefaults.create({
        data: {
          userId: ctx.user.id,
          isBillable: true,
          phase: null,
        },
      })
      return {
        isBillable: newDefaults.isBillable,
        phase: newDefaults.phase,
      }
    }

    return {
      isBillable: defaults.isBillable,
      phase: defaults.phase,
    }
  }),

  /**
   * Update user project defaults
   * Updates the default billable status and/or phase for new entries
   */
  updateDefaults: protectedProcedure
    .input(
      z.object({
        isBillable: z.boolean().optional(),
        phase: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await prisma.userProjectDefaults.upsert({
        where: { userId: ctx.user.id },
        create: {
          userId: ctx.user.id,
          isBillable: input.isBillable ?? true,
          phase: input.phase ?? null,
        },
        update: {
          ...(input.isBillable !== undefined && { isBillable: input.isBillable }),
          ...(input.phase !== undefined && { phase: input.phase || null }),
        },
      })

      return { success: true }
    }),
})
