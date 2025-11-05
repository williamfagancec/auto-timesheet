import { Lucia } from "lucia";
import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { prisma } from "database";

// Initialize Prisma adapter for Lucia
const adapter = new PrismaAdapter(prisma.session, prisma.user);

// Create Lucia instance
export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      // Using Vite proxy, all requests appear same-origin, so 'lax' works fine
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // CSRF protection
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
