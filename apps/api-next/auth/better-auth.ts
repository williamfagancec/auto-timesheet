import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { prisma } from "database"
import { hash, verify, type Options } from "@node-rs/argon2"

const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`)
  }
}

// Preserve existing Argon2 configuration from previous implementation
const argon2Options: Options = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,  // User requested email verification
    password: {
      hash: async (password) => await hash(password, argon2Options),
      verify: async ({ hash: hashedPassword, password }) =>
        await verify(hashedPassword, password, argon2Options),
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

  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET!,
  baseURL: process.env.API_URL || "http://localhost:3001",
})

export type Auth = typeof auth
