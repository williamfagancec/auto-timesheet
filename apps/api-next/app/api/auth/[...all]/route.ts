import { auth } from "../../../../auth/better-auth"
import { toNextJsHandler } from "better-auth/next-js"

// Mark as dynamic route (don't prerender during build)
export const dynamic = 'force-dynamic'

// Better-Auth handles all auth requests through this catch-all route
// Endpoints: /api/auth/signin/*, /api/auth/signup/*, /api/auth/callback/*, etc.
export const { GET, POST } = toNextJsHandler(auth)
