import { describe, it, expect, beforeEach, vi } from 'vitest'
import { authRouter } from '../auth'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@prisma/client'

// Mock the database module
vi.mock('database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    calendarConnection: {
      findUnique: vi.fn(),
    },
  },
}))

// Mock the calendar sync service
vi.mock('../../services/calendar-sync', () => ({
  syncUserEvents: vi.fn(),
}))

// Mock auth modules
vi.mock('../../auth/lucia', () => ({
  lucia: {
    createSession: vi.fn(),
    createSessionCookie: vi.fn(),
    createBlankSessionCookie: vi.fn(),
    invalidateSession: vi.fn(),
    validateSession: vi.fn(),
  },
}))

vi.mock('../../auth/password', () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}))

vi.mock('../../auth/google', () => ({
  google: {
    createAuthorizationURL: vi.fn(),
    validateAuthorizationCode: vi.fn(),
  },
  GOOGLE_SCOPES: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'],
}))

vi.mock('../../auth/encryption', () => ({
  encrypt: vi.fn((value: string) => `encrypted_${value}`),
  decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
}))

vi.mock('../../auth/oauth-state-store', () => ({
  storeOAuthState: vi.fn(),
  getOAuthState: vi.fn(),
}))

vi.mock('../../services/google-calendar', () => ({
  getUserTimezone: vi.fn(),
}))

import { prisma as mockPrisma } from 'database'
import { syncUserEvents } from '../../services/calendar-sync'
import { lucia } from '../../auth/lucia'
import { verifyPassword } from '../../auth/password'
import { google } from '../../auth/google'
import { encrypt } from '../../auth/encryption'
import { getUserTimezone } from '../../services/google-calendar'

describe('authRouter', () => {
  let ctx: any

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()

    // Create mock context
    ctx = {
      user: null,
      session: null,
      req: {
        cookies: {},
      },
      res: {
        setCookie: vi.fn(),
        clearCookie: vi.fn(),
      },
    }
  })

  describe('login', () => {
    it('should trigger calendar sync when user has calendar connection', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        hashedPassword: 'hashed_password',
      }

      const mockCalendarConnection = {
        id: 'conn123',
        userId: 'user123',
        provider: 'google',
        accessToken: 'encrypted_token',
        refreshToken: 'encrypted_refresh',
        expiresAt: new Date(Date.now() + 3600000),
      }

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        expiresAt: new Date(Date.now() + 86400000),
      }

      // Setup mocks
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(verifyPassword).mockResolvedValue(true)
      vi.mocked(lucia.createSession).mockResolvedValue(mockSession as any)
      vi.mocked(lucia.createSessionCookie).mockReturnValue({
        name: 'session',
        value: 'session_value',
        attributes: {},
      })
      vi.mocked(mockPrisma.calendarConnection.findUnique).mockResolvedValue(mockCalendarConnection as any)
      vi.mocked(syncUserEvents).mockResolvedValue({
        calendarsProcessed: 1,
        eventsCreated: 5,
        eventsUpdated: 2,
      })

      const caller = authRouter.createCaller(ctx as any)

      const result = await caller.login({
        email: 'test@example.com',
        password: 'password123',
      })

      // Verify login succeeded
      expect(result.success).toBe(true)
      expect(result.user.email).toBe('test@example.com')

      // Verify calendar sync was triggered
      expect(mockPrisma.calendarConnection.findUnique).toHaveBeenCalledWith({
        where: {
          userId_provider: {
            userId: 'user123',
            provider: 'google',
          },
        },
      })

      expect(syncUserEvents).toHaveBeenCalledWith('user123')
    })

    it('should not trigger calendar sync when user has no calendar connection', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        hashedPassword: 'hashed_password',
      }

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        expiresAt: new Date(Date.now() + 86400000),
      }

      // Setup mocks
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(verifyPassword).mockResolvedValue(true)
      vi.mocked(lucia.createSession).mockResolvedValue(mockSession as any)
      vi.mocked(lucia.createSessionCookie).mockReturnValue({
        name: 'session',
        value: 'session_value',
        attributes: {},
      })
      vi.mocked(mockPrisma.calendarConnection.findUnique).mockResolvedValue(null)

      const caller = authRouter.createCaller(ctx as any)

      const result = await caller.login({
        email: 'test@example.com',
        password: 'password123',
      })

      // Verify login succeeded
      expect(result.success).toBe(true)

      // Verify calendar sync was NOT triggered
      expect(syncUserEvents).not.toHaveBeenCalled()
    })

    it('should not fail login if calendar sync fails', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        hashedPassword: 'hashed_password',
      }

      const mockCalendarConnection = {
        id: 'conn123',
        userId: 'user123',
        provider: 'google',
        accessToken: 'encrypted_token',
        refreshToken: 'encrypted_refresh',
        expiresAt: new Date(Date.now() + 3600000),
      }

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        expiresAt: new Date(Date.now() + 86400000),
      }

      // Setup mocks
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(verifyPassword).mockResolvedValue(true)
      vi.mocked(lucia.createSession).mockResolvedValue(mockSession as any)
      vi.mocked(lucia.createSessionCookie).mockReturnValue({
        name: 'session',
        value: 'session_value',
        attributes: {},
      })
      vi.mocked(mockPrisma.calendarConnection.findUnique).mockResolvedValue(mockCalendarConnection as any)
      vi.mocked(syncUserEvents).mockRejectedValue(new Error('Sync failed'))

      const caller = authRouter.createCaller(ctx as any)

      // Login should still succeed even if sync fails
      const result = await caller.login({
        email: 'test@example.com',
        password: 'password123',
      })

      expect(result.success).toBe(true)
      expect(syncUserEvents).toHaveBeenCalled()
    })
  })

  describe('googleCallback', () => {
    it('should always trigger calendar sync after successful OAuth', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
      }

      const mockTokens = {
        accessToken: () => 'access_token',
        refreshToken: () => 'refresh_token',
        accessTokenExpiresAt: () => new Date(Date.now() + 3600000),
      }

      const mockGoogleUser = {
        id: 'google123',
        email: 'test@example.com',
        name: 'Test User',
      }

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        expiresAt: new Date(Date.now() + 86400000),
      }

      // Setup mocks
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(google.validateAuthorizationCode).mockResolvedValue(mockTokens as any)
      vi.mocked(getUserTimezone).mockResolvedValue('America/New_York')
      vi.mocked(mockPrisma.calendarConnection.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.calendarConnection.upsert).mockResolvedValue({
        id: 'conn123',
        userId: 'user123',
        provider: 'google',
      } as any)
      vi.mocked(lucia.createSession).mockResolvedValue(mockSession as any)
      vi.mocked(lucia.createSessionCookie).mockReturnValue({
        name: 'session',
        value: 'session_value',
        attributes: {},
      })
      vi.mocked(syncUserEvents).mockResolvedValue({
        calendarsProcessed: 2,
        eventsCreated: 10,
        eventsUpdated: 3,
      })

      // Mock fetch for Google user info
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGoogleUser,
      })

      ctx.req.cookies = {
        google_oauth_state: 'state123',
        google_code_verifier: 'verifier123',
      }

      const caller = authRouter.createCaller(ctx as any)

      const result = await caller.googleCallback({
        code: 'auth_code',
        state: 'state123',
      })

      // Verify OAuth succeeded
      expect(result.success).toBe(true)
      expect(result.user.email).toBe('test@example.com')

      // Verify calendar sync was ALWAYS triggered (regardless of selectedCalendarIds)
      expect(syncUserEvents).toHaveBeenCalledWith('user123')
    })

    it('should not fail OAuth if calendar sync fails', async () => {
      const mockUser = {
        id: 'user123',
        email: 'test@example.com',
        name: 'Test User',
      }

      const mockTokens = {
        accessToken: () => 'access_token',
        refreshToken: () => 'refresh_token',
        accessTokenExpiresAt: () => new Date(Date.now() + 3600000),
      }

      const mockGoogleUser = {
        id: 'google123',
        email: 'test@example.com',
        name: 'Test User',
      }

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        expiresAt: new Date(Date.now() + 86400000),
      }

      // Setup mocks
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockUser as any)
      vi.mocked(google.validateAuthorizationCode).mockResolvedValue(mockTokens as any)
      vi.mocked(getUserTimezone).mockResolvedValue('America/New_York')
      vi.mocked(mockPrisma.calendarConnection.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.calendarConnection.upsert).mockResolvedValue({
        id: 'conn123',
        userId: 'user123',
        provider: 'google',
      } as any)
      vi.mocked(lucia.createSession).mockResolvedValue(mockSession as any)
      vi.mocked(lucia.createSessionCookie).mockReturnValue({
        name: 'session',
        value: 'session_value',
        attributes: {},
      })
      vi.mocked(syncUserEvents).mockRejectedValue(new Error('No calendars selected'))

      // Mock fetch for Google user info
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGoogleUser,
      })

      ctx.req.cookies = {
        google_oauth_state: 'state123',
        google_code_verifier: 'verifier123',
      }

      const caller = authRouter.createCaller(ctx as any)

      // OAuth should still succeed even if sync fails
      const result = await caller.googleCallback({
        code: 'auth_code',
        state: 'state123',
      })

      expect(result.success).toBe(true)
      expect(syncUserEvents).toHaveBeenCalled()
    })
  })

  describe('googleOAuth', () => {
    it('should set prompt=consent and access_type=offline parameters', async () => {
      const mockUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      mockUrl.searchParams.set('client_id', 'test_client_id')
      mockUrl.searchParams.set('redirect_uri', 'http://localhost:3001/auth/google/callback')
      mockUrl.searchParams.set('response_type', 'code')

      vi.mocked(google.createAuthorizationURL).mockReturnValue(mockUrl)

      const caller = authRouter.createCaller(ctx as any)

      const result = await caller.googleOAuth()

      // Verify URL contains required parameters
      const url = new URL(result.url)
      expect(url.searchParams.get('prompt')).toBe('consent')
      expect(url.searchParams.get('access_type')).toBe('offline')
    })
  })
})

