import { router, protectedProcedure } from '../lib/trpc'
import { z } from 'zod'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'
import { listGoogleCalendars, type GoogleCalendar } from '../../api/src/services/google-calendar.js'
import { syncUserEvents } from '../../api/src/services/calendar-sync.js'

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
   * Connect Google Calendar
   * Links the user's Better-Auth Google Account to a CalendarConnection
   * Requires user to have authenticated via Google OAuth (Better-Auth)
   */
  connect: protectedProcedure.mutation(async ({ ctx }) => {
    // Check if user has a Google Account (via Better-Auth OAuth)
    const account = await prisma.account.findFirst({
      where: {
        userId: ctx.user.id,
        providerId: 'google',
      },
    })

    if (!account) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Please sign in with Google first to connect your calendar',
      })
    }

    // Check if connection already exists
    const existingConnection = await prisma.calendarConnection.findUnique({
      where: {
        userId_provider: {
          userId: ctx.user.id,
          provider: 'google',
        },
      },
    })

    if (existingConnection) {
      return {
        success: true,
        message: 'Calendar already connected',
      }
    }

    // Get access token to verify connection and detect timezone
    try {
      const { getValidAccessToken } = await import('../auth/token-refresh.js')
      const accessToken = await getValidAccessToken(ctx.user.id, 'google')

      // Detect user's timezone from Google Calendar
      const { getUserTimezone } = await import('../../api/src/services/google-calendar.js')
      const timezone = await getUserTimezone(accessToken)

      // Create CalendarConnection
      await prisma.calendarConnection.create({
        data: {
          userId: ctx.user.id,
          provider: 'google',
          timezone,
        },
      })

      return {
        success: true,
        message: 'Google Calendar connected successfully',
        timezone,
      }
    } catch (error) {
      console.error('[Calendar Connect] Failed to connect calendar:', error)

      // Surface specific errors for better UX
      if (error instanceof Error) {
        if (error.message.includes('TOKEN_REFRESH_FAILED') || error.message.includes('re-authenticate')) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Google authentication expired. Please sign in with Google again.',
          })
        }
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to connect Google Calendar. Please try again.',
      })
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
        const availableCalendarIds = new Set(availableCalendars.map((cal: GoogleCalendar) => cal.id))

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
  sync: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await syncUserEvents(ctx.user.id)

      return {
        success: true,
        ...result,
      }
    } catch (error) {
      console.error('Calendar sync failed:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to sync calendar events',
      })
    }
  }),

  /**
   * Get events for a specific date range
   */
  getEvents: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date(input.startDate)
      const endDate = new Date(input.endDate)

      const events = await prisma.calendarEvent.findMany({
        where: {
          userId: ctx.user.id,
          isDeleted: false,
          startTime: {
            lt: endDate,
          },
          endTime: {
            gt: startDate,
          },
        },
        orderBy: {
          startTime: 'asc',
        },
      })

      return { events }
    }),

  /**
   * Get calendar events with their categorization status
   * Shows all calendar events for date range with timesheet entry info
   */
  getEventsWithStatus: protectedProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date(input.startDate)
      const endDate = new Date(input.endDate)

      const events = await prisma.calendarEvent.findMany({
        where: {
          userId: ctx.user.id,
          isDeleted: false,
          startTime: {
            lt: endDate,
          },
          endTime: {
            gt: startDate,
          },
        },
        include: {
          entry: {
            include: {
              project: true,
            },
          },
        },
        orderBy: {
          startTime: 'asc',
        },
      })

      return events.map((event) => ({
        ...event,
        isCategorized: event.entry?.projectId != null && !event.entry?.isSkipped,
        isSkipped: event.entry?.isSkipped || false,
        projectName: event.entry?.project?.name,
        projectId: event.entry?.projectId,
        isBillable: event.entry?.isBillable ?? true,
      }))
    }),

  /**
   * Soft delete (hide) an event from timesheet
   */
  hideEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
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

      await prisma.calendarEvent.update({
        where: { id: input.eventId },
        data: { isDeleted: true },
      })

      return { success: true }
    }),
})
