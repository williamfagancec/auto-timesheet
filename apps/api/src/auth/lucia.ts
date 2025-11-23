import { Lucia, TimeSpan } from "lucia";
import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { prisma } from "database";

// Initialize Prisma adapter for Lucia
const adapter = new PrismaAdapter(prisma.session, prisma.user);

// Create Lucia instance
export const lucia = new Lucia(adapter, {
  // Session expires after 30 days of inactivity
  // Lucia automatically extends sessions in the second half of their lifetime
  sessionExpiresIn: new TimeSpan(30, "d"), // 30 days
  sessionCookie: {
    attributes: {
      // In production: Vercel (frontend) and Railway (API) are different domains
      // SameSite=none + Secure=true allows cross-domain cookies
      // In development: Vite proxy makes requests same-origin, so 'lax' works
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  },
  getUserAttributes: (attributes) => {
    return {
      email: attributes.email,
      name: attributes.name,
    };
  },
});

// Type declarations for Lucia
declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: DatabaseUserAttributes;
  }
}

interface DatabaseUserAttributes {
  email: string;
  name: string | null;
}
