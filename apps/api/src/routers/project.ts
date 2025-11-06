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
        sortBy: z.enum(['name', 'lastUsedAt', 'useCount']).optional().default('lastUsedAt'),
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

      // Determine sort order
      const orderBy: any = {}
      if (input.sortBy === 'name') {
        orderBy.name = 'asc'
      } else if (input.sortBy === 'lastUsedAt') {
        orderBy.lastUsedAt = 'desc'
      } else if (input.sortBy === 'useCount') {
        orderBy.useCount = 'desc'
      }

      const projects = await prisma.project.findMany({
        where: whereClause,
        orderBy,
        take: input.limit,
      })

      return projects
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
})
