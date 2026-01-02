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

// Using bcrypt for password hashing (Next.js compatible)
// Switched from Argon2 due to Next.js webpack compatibility issues with native binaries
const BCRYPT_ROUNDS = 12 // Strong security: 12 rounds ~250ms per hash

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
