import { describe, it, expect, beforeEach, vi } from 'vitest'
import { timesheetRouter } from '../timesheet'
import { TRPCError } from '@trpc/server'

// Mock the database module
vi.mock('database', () => ({
  prisma: {
    timesheetEntry: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    calendarEvent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    userProjectDefaults: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      timesheetEntry: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      project: {
        update: vi.fn(),
      },
      userProjectDefaults: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    })),
  },
}))

import { prisma as mockPrisma } from 'database'

describe('timesheetRouter - Reset to Events', () => {
  let ctx: any

  beforeEach(() => {
    vi.clearAllMocks()

    ctx = {
      user: {
        id: 'user123',
        email: 'test@example.com',
      },
      session: {
        id: 'session123',
      },
    }
  })

  describe('resetToEvents', () => {
    it('should delete all manual entries for the week', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z') // Monday
      const weekEnd = new Date('2024-01-08T00:00:00.000Z')

      // Mock the delete result
      vi.mocked(mockPrisma.timesheetEntry.deleteMany).mockResolvedValue({ count: 5 })

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.resetToEvents({
        weekStartDate: weekStart.toISOString(),
      })

      expect(result.success).toBe(true)
      expect(result.deletedCount).toBe(5)

      // Verify deleteMany was called with correct filter
      expect(mockPrisma.timesheetEntry.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user123',
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
    })

    it('should return 0 deleted count when no manual entries exist', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z')

      vi.mocked(mockPrisma.timesheetEntry.deleteMany).mockResolvedValue({ count: 0 })

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.resetToEvents({
        weekStartDate: weekStart.toISOString(),
      })

      expect(result.success).toBe(true)
      expect(result.deletedCount).toBe(0)
    })

    it('should reject non-Monday weekStartDate', async () => {
      const notMonday = new Date('2024-01-02T00:00:00.000Z') // Tuesday

      const caller = timesheetRouter.createCaller(ctx as any)

      await expect(
        caller.resetToEvents({
          weekStartDate: notMonday.toISOString(),
        })
      ).rejects.toThrow('weekStartDate must be a Monday at midnight UTC')
    })

    it('should handle database errors gracefully', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z')

      vi.mocked(mockPrisma.timesheetEntry.deleteMany).mockRejectedValue(
        new Error('Database connection failed')
      )

      const caller = timesheetRouter.createCaller(ctx as any)

      await expect(
        caller.resetToEvents({
          weekStartDate: weekStart.toISOString(),
        })
      ).rejects.toThrow('Failed to reset timesheet')
    })
  })

  describe('bulkCategorize - Auto-sync cleanup', () => {
    it('should clean up manual entries when recategorizing events', async () => {
      const mockEvent = {
        id: 'event123',
        userId: 'user123',
        startTime: new Date('2024-01-01T10:00:00.000Z'),
        endTime: new Date('2024-01-01T12:00:00.000Z'),
      }

      const mockExistingEntry = {
        id: 'entry123',
        userId: 'user123',
        eventId: 'event123',
        projectId: 'oldProject123', // Currently assigned to old project
        date: new Date('2024-01-01T10:00:00.000Z'),
        duration: 120,
        isManual: false,
      }

      const mockProject = {
        id: 'newProject456',
        userId: 'user123',
        name: 'New Project',
        isArchived: false,
      }

      const mockDefaults = {
        userId: 'user123',
        isBillable: true,
        phase: null,
      }

      // Setup mocks
      vi.mocked(mockPrisma.calendarEvent.findMany).mockResolvedValue([mockEvent] as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue([mockProject] as any)

      // Mock transaction behavior
      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback: any) => {
        const txMock = {
          timesheetEntry: {
            findUnique: vi.fn().mockResolvedValue(mockExistingEntry),
            update: vi.fn().mockResolvedValue({}),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          project: {
            update: vi.fn().mockResolvedValue({}),
          },
          userProjectDefaults: {
            findUnique: vi.fn().mockResolvedValue(mockDefaults),
            update: vi.fn().mockResolvedValue({}),
          },
        }

        const result = await callback(txMock)
        return result
      })

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.bulkCategorize({
        entries: [
          {
            eventId: 'event123',
            projectId: 'newProject456', // Recategorizing to new project
          },
        ],
      })

      expect(result.success).toBe(true)
      expect(result.updated).toBe(1)

      // Verify transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalled()
    })

    it('should create new entry when event has no existing entry', async () => {
      const mockEvent = {
        id: 'event123',
        userId: 'user123',
        startTime: new Date('2024-01-01T10:00:00.000Z'),
        endTime: new Date('2024-01-01T12:00:00.000Z'),
      }

      const mockProject = {
        id: 'project123',
        userId: 'user123',
        name: 'Test Project',
        isArchived: false,
      }

      const mockDefaults = {
        userId: 'user123',
        isBillable: true,
        phase: null,
      }

      vi.mocked(mockPrisma.calendarEvent.findMany).mockResolvedValue([mockEvent] as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue([mockProject] as any)

      vi.mocked(mockPrisma.$transaction).mockImplementation(async (callback: any) => {
        const txMock = {
          timesheetEntry: {
            findUnique: vi.fn().mockResolvedValue(null), // No existing entry
            create: vi.fn().mockResolvedValue({}),
          },
          project: {
            update: vi.fn().mockResolvedValue({}),
          },
          userProjectDefaults: {
            findUnique: vi.fn().mockResolvedValue(mockDefaults),
            update: vi.fn().mockResolvedValue({}),
          },
        }

        return await callback(txMock)
      })

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.bulkCategorize({
        entries: [
          {
            eventId: 'event123',
            projectId: 'project123',
          },
        ],
      })

      expect(result.success).toBe(true)
      expect(result.created).toBe(1)
    })

    it('should validate that events belong to the user', async () => {
      vi.mocked(mockPrisma.calendarEvent.findMany).mockResolvedValue([])

      const caller = timesheetRouter.createCaller(ctx as any)

      await expect(
        caller.bulkCategorize({
          entries: [
            {
              eventId: 'event123',
              projectId: 'project123',
            },
          ],
        })
      ).rejects.toThrow('Some events not found or do not belong to you')
    })

    it('should validate that projects belong to the user', async () => {
      const mockEvent = {
        id: 'event123',
        userId: 'user123',
        startTime: new Date('2024-01-01T10:00:00.000Z'),
        endTime: new Date('2024-01-01T12:00:00.000Z'),
      }

      vi.mocked(mockPrisma.calendarEvent.findMany).mockResolvedValue([mockEvent] as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue([]) // No projects found

      const caller = timesheetRouter.createCaller(ctx as any)

      await expect(
        caller.bulkCategorize({
          entries: [
            {
              eventId: 'event123',
              projectId: 'project123',
            },
          ],
        })
      ).rejects.toThrow('Some projects not found or do not belong to you')
    })
  })

  describe('getWeeklyGrid - Event vs Manual hours tracking', () => {
    it('should separate event hours from manual hours', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z')

      const mockProjects = [
        {
          id: 'project123',
          userId: 'user123',
          name: 'Test Project',
          isArchived: false,
          createdAt: new Date(),
        },
      ]

      const mockEntries = [
        {
          id: 'entry1',
          userId: 'user123',
          eventId: 'event1', // Event-sourced
          projectId: 'project123',
          date: new Date('2024-01-01T10:00:00.000Z'), // Monday
          duration: 120, // 2 hours
          isManual: false,
          isSkipped: false,
          notes: null,
        },
        {
          id: 'entry2',
          userId: 'user123',
          eventId: null, // Manual entry
          projectId: 'project123',
          date: new Date('2024-01-01T14:00:00.000Z'), // Monday
          duration: 60, // 1 hour
          isManual: true,
          isSkipped: false,
          notes: null,
        },
      ]

      vi.mocked(mockPrisma.timesheetEntry.findMany).mockResolvedValue(mockEntries as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue(mockProjects as any)

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.getWeeklyGrid({
        weekStartDate: weekStart.toISOString(),
      })

      // Should have one project
      expect(result.projects).toHaveLength(1)

      const project = result.projects[0]

      // Monday should have 3 total hours (2 from event + 1 manual)
      expect(project.dailyHours.mon).toBe(3)

      // Event hours should be 2
      expect(project.eventHours.mon).toBe(2)

      // Manual hours should be 1
      expect(project.manualHours.mon).toBe(1)

      // Other days should be 0
      expect(project.dailyHours.tue).toBe(0)
      expect(project.eventHours.tue).toBe(0)
      expect(project.manualHours.tue).toBe(0)
    })

    it('should handle week with only event-sourced entries', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z')

      const mockProjects = [
        {
          id: 'project123',
          userId: 'user123',
          name: 'Test Project',
          isArchived: false,
          createdAt: new Date(),
        },
      ]

      const mockEntries = [
        {
          id: 'entry1',
          userId: 'user123',
          eventId: 'event1',
          projectId: 'project123',
          date: new Date('2024-01-02T10:00:00.000Z'), // Tuesday
          duration: 180, // 3 hours
          isManual: false,
          isSkipped: false,
          notes: null,
        },
      ]

      vi.mocked(mockPrisma.timesheetEntry.findMany).mockResolvedValue(mockEntries as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue(mockProjects as any)

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.getWeeklyGrid({
        weekStartDate: weekStart.toISOString(),
      })

      const project = result.projects[0]

      // Tuesday should have 3 hours from events, 0 manual
      expect(project.dailyHours.tue).toBe(3)
      expect(project.eventHours.tue).toBe(3)
      expect(project.manualHours.tue).toBe(0)
    })

    it('should handle week with only manual entries', async () => {
      const weekStart = new Date('2024-01-01T00:00:00.000Z')

      const mockProjects = [
        {
          id: 'project123',
          userId: 'user123',
          name: 'Test Project',
          isArchived: false,
          createdAt: new Date(),
        },
      ]

      const mockEntries = [
        {
          id: 'entry1',
          userId: 'user123',
          eventId: null,
          projectId: 'project123',
          date: new Date('2024-01-03T10:00:00.000Z'), // Wednesday
          duration: 240, // 4 hours
          isManual: true,
          isSkipped: false,
          notes: 'Manual work',
        },
      ]

      vi.mocked(mockPrisma.timesheetEntry.findMany).mockResolvedValue(mockEntries as any)
      vi.mocked(mockPrisma.project.findMany).mockResolvedValue(mockProjects as any)

      const caller = timesheetRouter.createCaller(ctx as any)

      const result = await caller.getWeeklyGrid({
        weekStartDate: weekStart.toISOString(),
      })

      const project = result.projects[0]

      // Wednesday should have 4 hours manual, 0 from events
      expect(project.dailyHours.wed).toBe(4)
      expect(project.eventHours.wed).toBe(0)
      expect(project.manualHours.wed).toBe(4)
    })
  })
})
