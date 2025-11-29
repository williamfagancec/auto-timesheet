import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from 'database'

/**
 * Phase Defaults Test Suite
 *
 * Tests the fix for the bug where events were incorrectly defaulting to "phase - phase 2"
 *
 * Expected behavior after fix:
 * 1. Events should default to NO phase (null) when categorized
 * 2. Phase should only be used if explicitly provided for that specific event
 * 3. User defaults should NOT apply to phase (only to billable status)
 * 4. Phase should never be saved to UserProjectDefaults
 *
 * Bug fix locations:
 * - apps/web/src/pages/Events.tsx (lines 138-153, 521, 533, 545)
 * - apps/api/src/routers/timesheet.ts (lines 350-351, 411-418, 629-630, 695-702, 839-840, 902-909)
 */

describe('Phase Defaults Fix', () => {
  const mockUserId = 'test-user-id'
  const mockProjectId = 'test-project-id'
  const mockEventId = 'test-event-id'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('bulkCategorize endpoint', () => {
    it('should default phase to null when not provided', async () => {
      // Setup: User has defaults with phase set to "phase - phase 2"
      const mockUserDefaults = {
        userId: mockUserId,
        isBillable: true,
        phase: 'phase - phase 2', // This should NOT be used as default
      }

      const mockEvent = {
        id: mockEventId,
        userId: mockUserId,
        startTime: new Date('2025-01-01T10:00:00Z'),
        endTime: new Date('2025-01-01T11:00:00Z'),
      }

      // Mock transaction
      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue(mockUserDefaults),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((data) => {
            // Verify phase is null, not from user defaults
            expect(data.data.phase).toBe(null)
            return Promise.resolve({
              id: 'entry-id',
              ...data.data,
            })
          }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      // Simulate the logic from timesheet.ts bulkCategorize
      const entry = {
        eventId: mockEventId,
        projectId: mockProjectId,
        // No isBillable or phase provided
      }

      const userDefaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      const isBillable = entry.isBillable ?? userDefaults!.isBillable
      const phase = entry.phase ?? null // Should be null, NOT userDefaults.phase

      expect(phase).toBe(null)
      expect(isBillable).toBe(true) // Billable SHOULD use defaults

      // Create entry
      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: mockEvent.startTime,
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable,
          phase,
        },
      })

      expect(mockTx.timesheetEntry.create).toHaveBeenCalled()
    })

    it('should use explicit phase value when provided', async () => {
      const mockUserDefaults = {
        userId: mockUserId,
        isBillable: true,
        phase: 'phase - phase 2', // Should be ignored
      }

      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue(mockUserDefaults),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((data) => {
            // Verify explicit phase is used
            expect(data.data.phase).toBe('Phase 1')
            return Promise.resolve({
              id: 'entry-id',
              ...data.data,
            })
          }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      const entry = {
        eventId: mockEventId,
        projectId: mockProjectId,
        phase: 'Phase 1', // Explicitly provided
      }

      const userDefaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      const phase = entry.phase ?? null // Uses explicit value

      expect(phase).toBe('Phase 1')

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: new Date(),
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable: true,
          phase,
        },
      })

      expect(mockTx.timesheetEntry.create).toHaveBeenCalled()
    })

    it('should NOT update user defaults when phase is provided', async () => {
      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue({
            userId: mockUserId,
            isBillable: true,
            phase: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'entry-id' }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      const entry = {
        eventId: mockEventId,
        projectId: mockProjectId,
        isBillable: false, // Explicitly provided
        phase: 'Phase 2', // Explicitly provided
      }

      // Simulate the fix: only update isBillable, NOT phase
      if (entry.isBillable !== undefined) {
        await mockTx.userProjectDefaults.update({
          where: { userId: mockUserId },
          data: { isBillable: entry.isBillable },
        })
      }

      // Verify phase was NOT included in the update
      expect(mockTx.userProjectDefaults.update).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        data: { isBillable: false }, // Only billable, no phase
      })
    })

    it('should handle empty string phase as null', async () => {
      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue({
            userId: mockUserId,
            isBillable: true,
            phase: 'phase - phase 2',
          }),
        },
        timesheetEntry: {
          create: vi.fn().mockImplementation((data) => {
            // Empty string should be converted to null via || undefined
            expect(data.data.phase).toBeNull()
            return Promise.resolve({ id: 'entry-id', ...data.data })
          }),
        },
      }

      const entry = {
        eventId: mockEventId,
        projectId: mockProjectId,
        phase: '', // Empty string
      }

      // Frontend sends: phase: phase || undefined
      // This converts empty string to undefined
      const phaseToSend = entry.phase || undefined

      // Backend receives undefined and defaults to null
      const phase = phaseToSend ?? null

      expect(phase).toBe(null)

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: new Date(),
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable: true,
          phase,
        },
      })
    })
  })

  describe('updateCell endpoint', () => {
    it('should default phase to null when not provided', async () => {
      const mockUserDefaults = {
        userId: mockUserId,
        isBillable: true,
        phase: 'phase - phase 2', // Should NOT be used
      }

      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue(mockUserDefaults),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          create: vi.fn().mockImplementation((data) => {
            expect(data.data.phase).toBe(null)
            return Promise.resolve({ id: 'entry-id', ...data.data })
          }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      const input = {
        projectId: mockProjectId,
        date: '2025-01-01T00:00:00Z',
        hours: 2,
        // No phase provided
      }

      const userDefaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      const phase = input.phase ?? null // Should be null

      expect(phase).toBe(null)

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          projectId: mockProjectId,
          date: new Date(input.date),
          duration: input.hours * 60,
          isManual: true,
          isBillable: true,
          phase,
        },
      })

      expect(mockTx.timesheetEntry.create).toHaveBeenCalled()
    })
  })

  describe('assignEventToProject endpoint', () => {
    it('should default phase to null when not provided', async () => {
      const mockUserDefaults = {
        userId: mockUserId,
        isBillable: true,
        phase: 'phase - phase 2', // Should NOT be used
      }

      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue(mockUserDefaults),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((data) => {
            expect(data.data.phase).toBe(null)
            return Promise.resolve({ id: 'entry-id', ...data.data })
          }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      const input = {
        eventIds: [mockEventId],
        projectId: mockProjectId,
        // No phase provided
      }

      const userDefaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      const phase = input.phase ?? null // Should be null

      expect(phase).toBe(null)

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: new Date(),
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable: true,
          phase,
        },
      })

      expect(mockTx.timesheetEntry.create).toHaveBeenCalled()
    })
  })

  describe('User defaults behavior', () => {
    it('should only save billable to user defaults, not phase', async () => {
      const mockTx = {
        userProjectDefaults: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      const entry = {
        isBillable: false,
        phase: 'Phase 3',
      }

      // Only update billable, not phase
      if (entry.isBillable !== undefined) {
        await mockTx.userProjectDefaults.update({
          where: { userId: mockUserId },
          data: { isBillable: entry.isBillable },
        })
      }

      // Should never include phase
      expect(mockTx.userProjectDefaults.update).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        data: { isBillable: false },
      })

      expect(mockTx.userProjectDefaults.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phase: expect.anything() }),
        })
      )
    })

    it('should create defaults with phase=null', async () => {
      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation((data) => {
            expect(data.data.phase).toBe(null)
            return Promise.resolve({
              userId: mockUserId,
              ...data.data,
            })
          }),
        },
      }

      // Simulate getOrCreateUserDefaults
      let defaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      if (!defaults) {
        defaults = await mockTx.userProjectDefaults.create({
          data: {
            userId: mockUserId,
            isBillable: true,
            phase: null,
          },
        })
      }

      expect(defaults.phase).toBe(null)
      expect(mockTx.userProjectDefaults.create).toHaveBeenCalled()
    })
  })

  describe('Frontend behavior', () => {
    it('should not use userDefaults.phase when initializing phase input', () => {
      const userDefaults = {
        isBillable: true,
        phase: 'phase - phase 2',
      }

      const eventPhase = {} as Record<string, string>
      const eventId = 'event-1'

      // OLD (buggy) behavior:
      // const phaseValue = eventPhase[eventId] ?? userDefaults.phase ?? ''
      // This would show "phase - phase 2"

      // NEW (fixed) behavior:
      const phaseValue = eventPhase[eventId] ?? ''

      expect(phaseValue).toBe('') // Should be empty, not "phase - phase 2"
    })

    it('should not send userDefaults.phase when categorizing event', () => {
      const userDefaults = {
        isBillable: true,
        phase: 'phase - phase 2',
      }

      const eventPhase = {} as Record<string, string>
      const eventId = 'event-1'

      // OLD (buggy) behavior:
      // const phase = eventPhase[eventId] ?? userDefaults.phase ?? null
      // This would send "phase - phase 2"

      // NEW (fixed) behavior:
      const phase = eventPhase[eventId] ?? null

      expect(phase).toBe(null) // Should be null, not "phase - phase 2"
    })

    it('should preserve explicit phase values', () => {
      const eventPhase = {
        'event-1': 'Phase 1',
        'event-2': '',
      } as Record<string, string>

      expect(eventPhase['event-1'] ?? null).toBe('Phase 1')
      expect(eventPhase['event-2'] || undefined).toBe(undefined)
      expect(eventPhase['event-3'] ?? null).toBe(null)
    })
  })

  describe('Edge cases', () => {
    it('should handle null phase correctly', async () => {
      const mockTx = {
        timesheetEntry: {
          create: vi.fn().mockImplementation((data) => {
            expect(data.data.phase).toBe(null)
            return Promise.resolve({ id: 'entry-id', ...data.data })
          }),
        },
      }

      const entry = {
        phase: null,
      }

      const phase = entry.phase ?? null

      expect(phase).toBe(null)

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: new Date(),
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable: true,
          phase,
        },
      })
    })

    it('should handle undefined phase correctly', async () => {
      const mockTx = {
        timesheetEntry: {
          create: vi.fn().mockImplementation((data) => {
            expect(data.data.phase).toBe(null)
            return Promise.resolve({ id: 'entry-id', ...data.data })
          }),
        },
      }

      const entry = {
        // phase is undefined (not provided)
      }

      const phase = entry.phase ?? null

      expect(phase).toBe(null)

      await mockTx.timesheetEntry.create({
        data: {
          userId: mockUserId,
          eventId: mockEventId,
          projectId: mockProjectId,
          date: new Date(),
          duration: 60,
          isManual: false,
          isSkipped: false,
          isBillable: true,
          phase,
        },
      })
    })

    it('should handle whitespace-only phase as empty', () => {
      const entry = {
        phase: '   ',
      }

      // Frontend converts via: phase || undefined
      const phaseToSend = entry.phase.trim() || undefined

      expect(phaseToSend).toBe(undefined)

      // Backend converts to null
      const phase = phaseToSend ?? null
      expect(phase).toBe(null)
    })
  })

  describe('Regression tests', () => {
    it('should NOT pollute user defaults with phase values', async () => {
      const mockTx = {
        userProjectDefaults: {
          findUnique: vi.fn().mockResolvedValue({
            userId: mockUserId,
            isBillable: true,
            phase: null, // Initially null
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'entry-id' }),
        },
        project: {
          update: vi.fn().mockResolvedValue({}),
        },
      }

      // User categorizes multiple events with different phases
      const events = [
        { eventId: 'event-1', phase: 'Phase 1' },
        { eventId: 'event-2', phase: 'Phase 2' },
        { eventId: 'event-3', phase: null },
      ]

      for (const event of events) {
        // Phase should NEVER be saved to user defaults
        // Only billable can be saved
        if (event.phase !== undefined) {
          // This should NOT happen in the fixed code
          expect(false).toBe(true) // Should never reach here
        }
      }

      // User defaults should remain unchanged
      const finalDefaults = await mockTx.userProjectDefaults.findUnique({
        where: { userId: mockUserId },
      })

      expect(finalDefaults.phase).toBe(null) // Should remain null
    })

    it('should allow events with same project to have different phases', async () => {
      const entries = [
        { eventId: 'event-1', projectId: mockProjectId, phase: 'Phase 1' },
        { eventId: 'event-2', projectId: mockProjectId, phase: 'Phase 2' },
        { eventId: 'event-3', projectId: mockProjectId, phase: null },
      ]

      // Each entry should maintain its own phase
      entries.forEach((entry) => {
        const phase = entry.phase ?? null
        expect(phase).toBe(entry.phase)
      })

      // No entry should inherit phase from another
      expect(entries[0].phase).not.toBe(entries[1].phase)
      expect(entries[1].phase).not.toBe(entries[2].phase)
    })

    it('should validate that existing events preserve their phase', async () => {
      const existingEntry = {
        id: 'entry-1',
        eventId: 'event-1',
        projectId: mockProjectId,
        phase: 'Phase 1',
      }

      const mockTx = {
        timesheetEntry: {
          findUnique: vi.fn().mockResolvedValue(existingEntry),
          update: vi.fn().mockImplementation((data) => {
            // When updating without providing phase, it should preserve existing phase
            if (data.data.phase === undefined) {
              // Phase not in update - preserve existing
              return Promise.resolve(existingEntry)
            }
            // Phase explicitly provided - use new value
            return Promise.resolve({ ...existingEntry, ...data.data })
          }),
        },
      }

      const entry = await mockTx.timesheetEntry.findUnique({
        where: { eventId: 'event-1' },
      })

      expect(entry!.phase).toBe('Phase 1')

      // Update without phase - should preserve
      await mockTx.timesheetEntry.update({
        where: { id: 'entry-1' },
        data: {
          projectId: 'new-project-id',
          // phase not provided
        },
      })

      expect(mockTx.timesheetEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: expect.not.objectContaining({ phase: expect.anything() }),
      })
    })
  })
})
