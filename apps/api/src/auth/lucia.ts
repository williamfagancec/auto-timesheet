import { Lucia } from "lucia";
import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { prisma } from "database";

// Initialize Prisma adapter for Lucia
const adapter = new PrismaAdapter(prisma.session, prisma.user);

// Create Lucia instance
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      // For localhost development with different ports (3000 and 3001), we need sameSite: 'none'
      // to allow cookies to be sent in cross-origin requests. This requires secure: true,
      // but modern browsers allow secure cookies on localhost even without HTTPS.
      secure: true, // Always true (works on localhost and required for sameSite: 'none')
      sameSite: "none", // Allow cross-origin requests between localhost:3000 and localhost:3001
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
