import { router, protectedProcedure } from '../trpc.js'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'
import { listGoogleCalendars } from '../services/google-calendar.js'

export const calendarRouter = router({
  /**
   * Get connection status and selected calendars
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const connection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider: {
          userId: ctx.user.id,
          provider: 'google',
        },
      },
    })

    if (!connection) {
      return {
        connected: false,
        selectedCalendarIds: [],
      }
    }

    return {
      connected: true,
      selectedCalendarIds: (connection.selectedCalendarIds as string[]) || [],
    }
  }),

  /**
   * List all available Google calendars
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const connection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider: {
          userId: ctx.user.id,
          provider: 'google',
        },
      },
    })

    if (!connection) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Calendar connection not found. Please connect your Google Calendar first.',
      })
    }

    try {
      const calendars = await listGoogleCalendars(ctx.user.id)
      return { calendars }
    } catch (error) {
      console.error('Failed to list calendars:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch calendars from Google',
      })
    }
  }),

  /**
   * Update selected calendars for syncing
   */
  updateSelection: protectedProcedure
    .input(
      z.object({
        calendarIds: z.array(z.string()).min(1, 'Select at least one calendar'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const connection = await prisma.calendarConnection.findUnique({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: 'google',
          },
        },
      })

      if (!connection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Calendar connection not found',
        })
      }

      // Validate that all calendar IDs belong to the user
      try {
        const availableCalendars = await listGoogleCalendars(ctx.user.id)
        const availableCalendarIds = new Set(availableCalendars.map((cal) => cal.id))

        const invalidIds = input.calendarIds.filter((id) => !availableCalendarIds.has(id))

        if (invalidIds.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Invalid calendar IDs: ${invalidIds.join(', ')}`,
          })
        }
      } catch (error) {
        if (error instanceof TRPCError) throw error
        console.error('Failed to validate calendar IDs:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to validate calendar selection',
        })
      }

      await prisma.calendarConnection.update({
        where: {
          userId_provider: {
            userId: ctx.user.id,
            provider: 'google',
          },
        },
        data: {
          selectedCalendarIds: input.calendarIds,
        },
      })

      return {
        success: true,
        selectedCalendarIds: input.calendarIds,
      }
    }),

  /**
   * Trigger manual calendar sync
   */
  sync: protectedProcedure.mutation(async () => {
    // TODO: Implement calendar sync logic with BullMQ
    // This will be implemented in the calendar sync feature
    return {
      success: true,
      message: 'Sync initiated (to be implemented)',
    }
  }),
})
