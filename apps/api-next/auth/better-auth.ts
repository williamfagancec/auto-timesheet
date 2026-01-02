import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "database"
import bcrypt from "bcryptjs"

const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`)
  }
}

/**
 * Password Hashing Configuration
 *
 * Using bcrypt with 12 rounds for Next.js compatibility. While bcrypt provides acceptable
 * security (~250ms per hash, resistant to brute force attacks), Argon2id would offer
 * superior resistance to GPU/ASIC attacks due to its memory-hard properties, which make
 * parallel cracking significantly more expensive.
 *
 * Tradeoff rationale:
 * - bcrypt chosen to avoid Next.js native binary externals configuration complexity
 * - 12 rounds balances security with user experience for typical authentication workloads
 * - Still meets OWASP recommendations for password hashing (10+ rounds minimum)
 * - Suitable for web application authentication where network latency dominates UX
 *
 * Security note: For high-security applications or those expecting targeted attacks,
 * consider migrating to Argon2id once Next.js/webpack native module support improves.
 */
const BCRYPT_ROUNDS = 12

const secret = process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET
if (!secret) {
  throw new Error('Missing required environment variable: BETTER_AUTH_SECRET or SESSION_SECRET')
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,  // User requested email verification
    password: {
      hash: async (password) => await bcrypt.hash(password, BCRYPT_ROUNDS),
      verify: async ({ hash: hashedPassword, password }) =>
        await bcrypt.compare(password, hashedPassword),
    },
  },

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Scopes for Google OAuth - calendar access
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      // Required parameters to obtain refresh tokens
      accessType: "offline",
      prompt: "select_account consent",
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30,  // 30 days (preserves existing behavior)
    updateAge: 60 * 60 * 24,        // Refresh session after 1 day of activity
  },

  secret,
  baseURL: process.env.API_URL || "http://localhost:3001",
})

export type Auth = typeof auth
