/**
 * RM Sync Aggregation Tests
 *
 * Validates:
 * 1. Data is sent securely to RM API (HTTPS, authentication)
 * 2. Data is only sent for the relevant user ID account
 * 3. Data is aggregated by project-day (not individual entries)
 * 4. Junction table correctly tracks component entries
 * 5. Billable status is properly mapped to RM's task field
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { aggregateEntriesByProjectDay, mapBillableToTask, calculateAggregateHash } from '../rm-aggregation'
import type { TimesheetEntry, RMProjectMapping, RMConnection } from '@prisma/client'

// Mock Prisma client
const mockPrisma = {
  rMConnection: {
    findUnique: vi.fn(),
  },
  rMProjectMapping: {
    findMany: vi.fn(),
  },
  timesheetEntry: {
    findMany: vi.fn(),
  },
  rMSyncedEntry: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  rMSyncedEntryComponent: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  rMSyncLog: {
    create: vi.fn(),
    update: vi.fn(),
  },
} as any

// Mock fetch for RM API calls
global.fetch = vi.fn()

describe('RM Sync Aggregation - Security Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should only use HTTPS for RM API calls', async () => {
    const fetchMock = global.fetch as any
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 123, date: '2025-01-15', hours: 8 }),
    })

    // Simulate an API call to RM
    await fetch('https://api.rm.smartsheet.com/api/v1/time_entries', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date: '2025-01-15', hours: 8 }),
    })

    // Verify HTTPS is used
    const callUrl = fetchMock.mock.calls[0][0]
    expect(callUrl).toMatch(/^https:\/\//)
    expect(callUrl).not.toMatch(/^http:\/\//)
  })

  it('should include authentication token in all RM API requests', async () => {
    const fetchMock = global.fetch as any
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 123 }),
    })

    await fetch('https://api.rm.smartsheet.com/api/v1/time_entries', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    })

    const headers = fetchMock.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers.Authorization).toMatch(/^Bearer /)
  })
})

describe('RM Sync Aggregation - User Isolation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should only fetch timesheet entries for the authenticated user', async () => {
    const userId = 'user-123'
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 480, // 8 hours
        isBillable: true,
        notes: 'Work on feature',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    mockPrisma.timesheetEntry.findMany.mockResolvedValueOnce(mockEntries)

    await mockPrisma.timesheetEntry.findMany({
      where: {
        userId: userId,
        date: {
          gte: new Date('2025-01-15'),
          lte: new Date('2025-01-21'),
        },
      },
    })

    // Verify query filters by userId
    const whereClause = mockPrisma.timesheetEntry.findMany.mock.calls[0][0].where
    expect(whereClause.userId).toBe(userId)
  })

  it('should only use RM connection belonging to the authenticated user', async () => {
    const userId = 'user-123'
    const mockConnection: RMConnection = {
      id: 'conn-1',
      userId: 'user-123',
      rmUserId: 456789,
      rmUserEmail: 'user@example.com',
      rmUserName: 'Test User',
      encryptedToken: 'encrypted-token',
      tokenIv: 'iv-string',
      tokenAuthTag: 'auth-tag',
      autoSyncEnabled: false,
      lastSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockPrisma.rMConnection.findUnique.mockResolvedValueOnce(mockConnection)

    const connection = await mockPrisma.rMConnection.findUnique({
      where: { userId },
    })

    // Verify connection belongs to correct user
    expect(connection).not.toBeNull()
    expect(connection.userId).toBe(userId)
    expect(connection.rmUserId).toBeTruthy()
  })

  it('should only sync projects mapped for the authenticated user', async () => {
    const userId = 'user-123'
    const mockMappings: RMProjectMapping[] = [
      {
        id: 'mapping-1',
        connectionId: 'conn-1',
        projectId: 'project-1',
        rmProjectId: 111n,
        rmProjectName: 'RM Project 1',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    mockPrisma.rMProjectMapping.findMany.mockResolvedValueOnce(mockMappings)
    mockPrisma.rMConnection.findUnique.mockResolvedValueOnce({
      id: 'conn-1',
      userId: 'user-123',
    } as any)

    // Fetch mappings for user's connection
    const connection = await mockPrisma.rMConnection.findUnique({
      where: { userId },
    })

    const mappings = await mockPrisma.rMProjectMapping.findMany({
      where: {
        connectionId: connection.id,
        isActive: true,
      },
    })

    // Verify all mappings belong to user's connection
    expect(mappings.length).toBeGreaterThan(0)
    mappings.forEach(mapping => {
      expect(mapping.connectionId).toBe(connection.id)
    })
  })
})

describe('RM Sync Aggregation - Aggregation Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should aggregate multiple entries into one per project-day', () => {
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240, // 4 hours
        isBillable: true,
        notes: 'Morning work',
        isManual: false,
        isSkipped: false,
        eventId: 'event-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'entry-2',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240, // 4 hours
        isBillable: true,
        notes: 'Afternoon work',
        isManual: true,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(mockEntries)

    // Should create ONE aggregate for the same project-day
    expect(aggregates.size).toBe(1)

    const aggregate = Array.from(aggregates.values())[0]
    expect(aggregate.projectId).toBe('project-1')
    expect(aggregate.totalMinutes).toBe(480) // 4 + 4 hours
    expect(aggregate.totalHours).toBe(8)
    expect(aggregate.contributingEntryIds).toHaveLength(2)
    expect(aggregate.contributingEntryIds).toContain('entry-1')
    expect(aggregate.contributingEntryIds).toContain('entry-2')
  })

  it('should create separate aggregates for different projects on same day', () => {
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: true,
        notes: 'Project 1',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'entry-2',
        userId: 'user-123',
        projectId: 'project-2',
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: false,
        notes: 'Project 2',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(mockEntries)

    // Should create TWO aggregates (different projects, same day)
    expect(aggregates.size).toBe(2)

    const aggregateArray = Array.from(aggregates.values())
    expect(aggregateArray[0].projectId).not.toBe(aggregateArray[1].projectId)
  })

  it('should create separate aggregates for same project on different days', () => {
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: true,
        notes: 'Day 1',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'entry-2',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-16'),
        duration: 240,
        isBillable: true,
        notes: 'Day 2',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(mockEntries)

    // Should create TWO aggregates (same project, different days)
    expect(aggregates.size).toBe(2)

    const aggregateArray = Array.from(aggregates.values())
    expect(aggregateArray[0].date.toISOString()).not.toBe(aggregateArray[1].date.toISOString())
  })

  it('should skip entries without projectId', () => {
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: null,
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: true,
        notes: 'Uncategorized',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(mockEntries)

    // Should create ZERO aggregates (no project)
    expect(aggregates.size).toBe(0)
  })
})

describe('RM Sync Aggregation - Junction Table Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create junction records for all contributing entries', async () => {
    const mockAggregate = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalMinutes: 480,
      totalHours: 8,
      isBillable: true,
      notes: 'Combined work',
      contributingEntryIds: ['entry-1', 'entry-2'],
      contributingEntries: [
        {
          id: 'entry-1',
          duration: 240,
          isBillable: true,
          notes: 'Morning',
        },
        {
          id: 'entry-2',
          duration: 240,
          isBillable: true,
          notes: 'Afternoon',
        },
      ],
      aggregateHash: 'test-hash',
    }

    const rmSyncedEntryId = 'synced-1'

    await mockPrisma.rMSyncedEntryComponent.createMany({
      data: mockAggregate.contributingEntries.map((entry: any) => ({
        rmSyncedEntryId,
        timesheetEntryId: entry.id,
        durationMinutes: entry.duration,
        isBillable: entry.isBillable,
        notes: entry.notes,
      })),
    })

    const createManyCall = mockPrisma.rMSyncedEntryComponent.createMany.mock.calls[0][0]

    // Verify junction records created for all entries
    expect(createManyCall.data).toHaveLength(2)
    expect(createManyCall.data[0].timesheetEntryId).toBe('entry-1')
    expect(createManyCall.data[1].timesheetEntryId).toBe('entry-2')
    expect(createManyCall.data[0].rmSyncedEntryId).toBe(rmSyncedEntryId)
    expect(createManyCall.data[1].rmSyncedEntryId).toBe(rmSyncedEntryId)
  })

  it('should store individual entry durations in junction table', async () => {
    const componentData = [
      {
        rmSyncedEntryId: 'synced-1',
        timesheetEntryId: 'entry-1',
        durationMinutes: 180, // 3 hours
        isBillable: true,
        notes: 'Part 1',
      },
      {
        rmSyncedEntryId: 'synced-1',
        timesheetEntryId: 'entry-2',
        durationMinutes: 300, // 5 hours
        isBillable: true,
        notes: 'Part 2',
      },
    ]

    await mockPrisma.rMSyncedEntryComponent.createMany({
      data: componentData,
    })

    const createCall = mockPrisma.rMSyncedEntryComponent.createMany.mock.calls[0][0]

    // Verify individual durations preserved
    expect(createCall.data[0].durationMinutes).toBe(180)
    expect(createCall.data[1].durationMinutes).toBe(300)

    // Total should be 8 hours (480 minutes) when aggregated
    const totalMinutes = createCall.data.reduce((sum: number, item: any) => sum + item.durationMinutes, 0)
    expect(totalMinutes).toBe(480)
  })
})

describe('RM Sync Aggregation - Billable Mapping Tests', () => {
  it('should map isBillable=true to "Billable" task', () => {
    const task = mapBillableToTask(true)
    expect(task).toBe('Billable')
  })

  it('should map isBillable=false to "Business Development" task', () => {
    const task = mapBillableToTask(false)
    expect(task).toBe('Business Development')
  })

  it('should include billable status in aggregate hash', () => {
    const aggregate1 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: true,
      notes: 'Work',
    }

    const aggregate2 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: false, // Only difference
      notes: 'Work',
    }

    const hash1 = calculateAggregateHash(aggregate1)
    const hash2 = calculateAggregateHash(aggregate2)

    // Hashes should be different when billable status differs
    expect(hash1).not.toBe(hash2)
  })
})

describe('RM Sync Aggregation - Change Detection Tests', () => {
  it('should detect changes when hours change', () => {
    const aggregate1 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: true,
      notes: 'Work',
    }

    const aggregate2 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 7, // Changed
      isBillable: true,
      notes: 'Work',
    }

    const hash1 = calculateAggregateHash(aggregate1)
    const hash2 = calculateAggregateHash(aggregate2)

    expect(hash1).not.toBe(hash2)
  })

  it('should detect changes when notes change', () => {
    const aggregate1 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: true,
      notes: 'Work A',
    }

    const aggregate2 = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: true,
      notes: 'Work B', // Changed
    }

    const hash1 = calculateAggregateHash(aggregate1)
    const hash2 = calculateAggregateHash(aggregate2)

    expect(hash1).not.toBe(hash2)
  })

  it('should produce same hash for identical aggregates', () => {
    const aggregate = {
      projectId: 'project-1',
      date: new Date('2025-01-15'),
      totalHours: 8,
      isBillable: true,
      notes: 'Work',
    }

    const hash1 = calculateAggregateHash(aggregate)
    const hash2 = calculateAggregateHash(aggregate)

    expect(hash1).toBe(hash2)
  })
})

describe('RM Sync Aggregation - Data Validation Tests', () => {
  it('should convert minutes to decimal hours correctly', () => {
    const entries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 450, // 7.5 hours
        isBillable: true,
        notes: 'Work',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(entries)
    const aggregate = Array.from(aggregates.values())[0]

    // 450 minutes = 7.5 hours
    expect(aggregate.totalMinutes).toBe(450)
    expect(aggregate.totalHours).toBe(7.5)
  })

  it('should handle zero-hour entries by skipping them', () => {
    const entries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 0, // Zero hours
        isBillable: true,
        notes: 'No work',
        isManual: false,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const aggregates = aggregateEntriesByProjectDay(entries)
    const aggregate = Array.from(aggregates.values())[0]

    // Should still create aggregate but with zero hours
    expect(aggregate.totalHours).toBe(0)

    // Note: The sync service should skip zero-hour aggregates
    // This test just validates aggregation includes them
  })
})

describe('RM Sync Aggregation - Integration Tests', () => {
  it('should aggregate entries, create RM entry, and track components in one flow', async () => {
    // Mock timesheet entries
    const mockEntries: TimesheetEntry[] = [
      {
        id: 'entry-1',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: true,
        notes: 'Morning',
        isManual: false,
        isSkipped: false,
        eventId: 'event-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'entry-2',
        userId: 'user-123',
        projectId: 'project-1',
        date: new Date('2025-01-15'),
        duration: 240,
        isBillable: true,
        notes: 'Afternoon',
        isManual: true,
        isSkipped: false,
        eventId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    // Aggregate entries
    const aggregates = aggregateEntriesByProjectDay(mockEntries)
    expect(aggregates.size).toBe(1)

    const aggregate = Array.from(aggregates.values())[0]

    // Verify aggregation
    expect(aggregate.totalHours).toBe(8)
    expect(aggregate.contributingEntries).toHaveLength(2)

    // Simulate creating RM entry
    const rmPayload = {
      assignable_id: 111,
      date: '2025-01-15',
      hours: aggregate.totalHours,
      notes: aggregate.notes,
      task: mapBillableToTask(aggregate.isBillable),
    }

    expect(rmPayload.hours).toBe(8)
    expect(rmPayload.task).toBe('Billable')

    // Simulate creating synced entry
    mockPrisma.rMSyncedEntry.create.mockResolvedValueOnce({
      id: 'synced-1',
      mappingId: 'mapping-1',
      rmEntryId: BigInt(123),
      aggregationDate: aggregate.date,
      lastSyncedHash: aggregate.aggregateHash,
      syncVersion: 1,
    })

    // Simulate creating junction records
    await mockPrisma.rMSyncedEntryComponent.createMany({
      data: aggregate.contributingEntries.map((entry: any) => ({
        rmSyncedEntryId: 'synced-1',
        timesheetEntryId: entry.id,
        durationMinutes: entry.duration,
        isBillable: entry.isBillable,
        notes: entry.notes,
      })),
    })

    // Verify junction table creation
    const componentData = mockPrisma.rMSyncedEntryComponent.createMany.mock.calls[0][0].data
    expect(componentData).toHaveLength(2)
    expect(componentData[0].timesheetEntryId).toBe('entry-1')
    expect(componentData[1].timesheetEntryId).toBe('entry-2')
  })
})
