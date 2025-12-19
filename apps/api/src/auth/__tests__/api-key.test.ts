import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateApiKey, getUserForApiKey } from '../api-key'
import { prisma } from 'database'
import { TRPCError } from '@trpc/server'

vi.mock('database')

describe('API Key Authentication', () => {
  const originalEnv = process.env.TEAM_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv) {
      process.env.TEAM_API_KEY = originalEnv
    } else {
      delete process.env.TEAM_API_KEY
    }
  })

  describe('validateApiKey', () => {
    it('should return false when no auth header provided', () => {
      process.env.TEAM_API_KEY = 'test-key'
      expect(validateApiKey(undefined)).toBe(false)
    })

    it('should return false when TEAM_API_KEY not configured', () => {
      delete process.env.TEAM_API_KEY

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(validateApiKey('Bearer test-key')).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith('[API Key] TEAM_API_KEY not configured in environment variables')
      consoleSpy.mockRestore()
    })

    it('should return false when auth header format is invalid', () => {
      process.env.TEAM_API_KEY = 'test-key'

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(validateApiKey('InvalidFormat test-key')).toBe(false)
      expect(validateApiKey('test-key')).toBe(false)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('should return false when API key does not match', () => {
      process.env.TEAM_API_KEY = 'correct-key'

      expect(validateApiKey('Bearer wrong-key')).toBe(false)
    })

    it('should return true when API key matches', () => {
      process.env.TEAM_API_KEY = 'correct-key'

      expect(validateApiKey('Bearer correct-key')).toBe(true)
    })

    it('should be case-insensitive for Bearer prefix', () => {
      process.env.TEAM_API_KEY = 'test-key'

      expect(validateApiKey('bearer test-key')).toBe(true)
      expect(validateApiKey('BEARER test-key')).toBe(true)
      expect(validateApiKey('Bearer test-key')).toBe(true)
    })

    it('should handle keys with special characters', () => {
      process.env.TEAM_API_KEY = 'abc123-def456_GHI789'

      expect(validateApiKey('Bearer abc123-def456_GHI789')).toBe(true)
      expect(validateApiKey('Bearer abc123-def456_WRONG')).toBe(false)
    })

    it('should use constant-time comparison (same length)', () => {
      process.env.TEAM_API_KEY = 'correct-key-12345'

      // Both keys have same length but different content
      expect(validateApiKey('Bearer correct-key-12345')).toBe(true)
      expect(validateApiKey('Bearer correct-key-99999')).toBe(false)
    })

    it('should handle different length keys safely', () => {
      process.env.TEAM_API_KEY = 'correct-key'

      // Different length should return false immediately
      expect(validateApiKey('Bearer short')).toBe(false)
      expect(validateApiKey('Bearer much-longer-incorrect-key')).toBe(false)
    })
  })

  describe('getUserForApiKey', () => {
    it('should throw UNAUTHORIZED when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await expect(getUserForApiKey('invalid-user-id'))
        .rejects
        .toThrow(TRPCError)

      await expect(getUserForApiKey('invalid-user-id'))
        .rejects
        .toMatchObject({
          code: 'UNAUTHORIZED',
          message: 'Invalid user ID',
        })

      expect(consoleSpy).toHaveBeenCalledWith('[API Key] User not found: invalid-user-id')
      consoleSpy.mockRestore()
    })

    it('should return user when user exists', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        rmUserId: 42,
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await getUserForApiKey('user-123')

      expect(result).toEqual(mockUser)
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: {
          id: true,
          email: true,
          name: true,
          rmUserId: true,
        },
      })
    })

    it('should handle user without rmUserId', async () => {
      const mockUser = {
        id: 'user-456',
        email: 'user@example.com',
        name: 'Another User',
        rmUserId: null,
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await getUserForApiKey('user-456')

      expect(result).toEqual(mockUser)
      expect(result.rmUserId).toBeNull()
    })

    it('should handle user without name', async () => {
      const mockUser = {
        id: 'user-789',
        email: 'noname@example.com',
        name: null,
        rmUserId: 10,
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      const result = await getUserForApiKey('user-789')

      expect(result).toEqual(mockUser)
      expect(result.name).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Database connection failed'))

      await expect(getUserForApiKey('user-123'))
        .rejects
        .toThrow('Database connection failed')
    })
  })

  describe('Integration: validateApiKey + getUserForApiKey', () => {
    it('should complete full authentication flow', async () => {
      process.env.TEAM_API_KEY = 'valid-team-key-12345'

      const mockUser = {
        id: 'user-abc',
        email: 'integrated@example.com',
        name: 'Integration Test',
        rmUserId: 5,
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any)

      // Step 1: Validate API key
      const isValidKey = validateApiKey('Bearer valid-team-key-12345')
      expect(isValidKey).toBe(true)

      // Step 2: Get user
      if (isValidKey) {
        const user = await getUserForApiKey('user-abc')
        expect(user).toEqual(mockUser)
      }
    })

    it('should reject invalid key in full flow', async () => {
      process.env.TEAM_API_KEY = 'valid-team-key-12345'

      // Step 1: Validate API key (should fail)
      const isValidKey = validateApiKey('Bearer wrong-key')
      expect(isValidKey).toBe(false)

      // Step 2: Should not proceed to getUserForApiKey
      // In real code, context creation would stop here
    })

    it('should reject invalid user in full flow', async () => {
      process.env.TEAM_API_KEY = 'valid-team-key-12345'

      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)

      // Step 1: Validate API key (should pass)
      const isValidKey = validateApiKey('Bearer valid-team-key-12345')
      expect(isValidKey).toBe(true)

      // Step 2: Get user (should fail)
      await expect(getUserForApiKey('non-existent-user'))
        .rejects
        .toThrow(TRPCError)
    })
  })
})
