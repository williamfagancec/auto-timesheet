# Auto Timesheet - Time Tracking App

## Project Overview
A personal time tracking tool that automatically syncs with Google Calendar and intelligently categorizes work time using AI-powered suggestions, eliminating manual timesheet entry.

## Tech Stack

### Frontend
- React 18 + TypeScript + Vite
- Tailwind CSS
- Zustand (global state) + TanStack Query (server state)
- React Hook Form + Zod validation
- Radix UI components
- React Router v6
- tRPC client

### Backend
- Node.js 20.x + Fastify
- tRPC (end-to-end type safety)
- PostgreSQL + Prisma ORM
- Redis (Upstash) for caching
- BullMQ for background jobs
- Lucia Auth + Google OAuth 2.0
- Zod validation

### Infrastructure
- Turborepo monorepo
- Neon PostgreSQL (production)
- Upstash Redis
- Vercel (frontend), Railway/Fly.io (backend planned)

## Project Structure

```
auto-timesheet/
├── apps/
│   ├── web/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/     # UI components
│   │   │   ├── hooks/          # Custom hooks
│   │   │   ├── lib/            # Utilities & tRPC client
│   │   │   ├── pages/          # Route pages
│   │   │   ├── stores/         # Zustand stores
│   │   │   └── styles/         # Global styles
│   │   └── package.json
│   └── api/                    # Fastify backend
│       ├── src/
│       │   ├── routers/        # tRPC routers
│       │   ├── services/       # Business logic
│       │   ├── jobs/           # Background jobs
│       │   ├── auth/           # Authentication
│       │   └── db/             # Database & Prisma
│       └── package.json
├── packages/
│   ├── database/               # Shared Prisma schema
│   ├── shared/                 # Shared types & utilities
│   └── config/                 # Shared configs
├── turbo.json
└── package.json
```

## Core Features (MVP Scope)

### 1. User Authentication
- Email/password signup and login (Argon2 hashing)
- Google OAuth integration with encrypted token storage (AES-256-GCM)
- Automatic token refresh (5-minute buffer before expiry)
- Session management with Lucia Auth

### 2. Calendar Integration
- List and select Google calendars to sync
- Fetch calendar events via Google Calendar API
- Store events with metadata (title, time, attendees)

### 3. Time Tracking
- Automatic timesheet entries from calendar events
- Manual time entry creation
- Project categorization and assignment
- Weekly review and approval workflow

### 4. AI Categorization (Rule-based)
- Learn patterns from user categorizations
- Suggest projects for new events based on:
  - Title keywords
  - Attendee emails
  - Calendar source
  - Recurring event patterns
- Improve accuracy based on user corrections

## Database Schema

See `packages/database/prisma/schema.prisma` for the complete schema.

**Key Models:**
- `User` - User accounts and authentication
- `Session` - Lucia Auth sessions
- `CalendarConnection` - OAuth tokens and selected calendars
- `CalendarEvent` - Synced calendar events
- `Project` - User-defined project categories
- `TimesheetEntry` - Time entries (manual or from events)
- `CategoryRule` - AI learning rules for auto-categorization

## Security Implementation

- **OAuth Tokens**: AES-256-GCM encryption at rest with auth tags
- **Sessions**: httpOnly, sameSite cookies (CSRF protection)
- **Rate Limiting**: 100 requests/minute (global)
- **Input Validation**: Zod schemas on all endpoints
- **Password Hashing**: Argon2 (OWASP recommended)
- **CORS**: Configured for frontend domain with credentials

## Development

### Local Setup
```bash
pnpm install
pnpm db:migrate
pnpm dev              # Start all services
pnpm dev:web          # Frontend only (port 3000)
pnpm dev:api          # Backend only (port 3001)
```

### Environment Variables
See `.env` file. Key variables:
- `DATABASE_URL` - Neon PostgreSQL connection
- `REDIS_URL` - Upstash Redis (needs read-write user)
- `SESSION_SECRET`, `ENCRYPTION_KEY` - Auto-generated
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `GOOGLE_REDIRECT_URI` - Callback URL

### Database Commands
```bash
pnpm db:push          # Push schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio
```

## Success Metrics (MVP)
- User completes first weekly review in < 5 minutes
- AI suggestion accuracy > 60% after 3 weeks
- 3+ weeks user retention
- 8/10 beta users recommend to colleague


## Architecture Decisions

- **Fastify** over Express: 2x faster, TypeScript-first, schema validation
- **tRPC**: End-to-end type safety, no API docs needed, perfect for monorepos
- **Zustand**: Less boilerplate than Context API, better performance
- **BullMQ**: Redis-based reliability, job scheduling, perfect for calendar sync
- **Lucia Auth**: Modern, type-safe, flexible session management, OAuth support
- **Argon2**: OWASP recommended over bcrypt
- **AES-256-GCM**: Authenticated encryption prevents token tampering

## Philosophy

**SCL (Simple, Complete, Lovable)**: Build something simple that works completely and that users will love.

- Focus on core MVP: calendar sync + AI categorization
- No exports, team features, or complex reporting in v1
- Users should complete weekly review in < 5 minutes
- Simple rule-based AI is sufficient for MVP
- Minimize friction at every step

---

## AI Agent Instructions

**IMPORTANT: Read this section at the start and end of every session**

### Session Start Protocol
When beginning work on this project:
1. Read this claude.md file in its entirety to understand the current project state
2. Review any recent changes to understand what has been implemented
3. Check the project structure to see what files and features exist
4. Understand the current development priorities and MVP scope

### Session End Protocol
When completing work on this project:
1. Re-read this claude.md file
2. Update the relevant sections to reflect:
   - New features that have been implemented
   - Changes to the architecture or tech stack
   - Updated API endpoints or procedures that now exist
   - New database models or schema changes
   - Modified development workflow or commands
3. Add notes about any technical decisions made during the session
4. Update the "Current Status" section below with what has been completed

### Maintaining Context
- This file is the source of truth for project architecture and decisions
- Keep it up-to-date as features are built
- Document deviations from the original plan
- Note any blockers or technical challenges encountered
- Update the checklist items as they are completed

---

## Current Status

### ✅ Completed

**Infrastructure**

- Turborepo monorepo with pnpm workspaces
- Database: Neon PostgreSQL (deployed, migrated)
- Schema: All 7 models defined and indexed
- Environment: OAuth, encryption keys, Redis configured

**Backend - Authentication (Epic 1)**

- Email/password signup and login (Argon2)
- Google OAuth with PKCE flow (Arctic)
- Session management (Lucia Auth)
- Token encryption (AES-256-GCM) and auto-refresh
- Rate limiting (100 req/min global)
- Security: httpOnly/sameSite cookies, CSRF protection

**Backend - Calendar Integration**

- List Google calendars with pagination
- Calendar selection and validation
- Status endpoint for connection checking
- Google Calendar service (fetch events)

**Shared Packages**

- Zod schemas for validation
- Config constants (API, calendar, AI settings)
- Utility functions (duration formatting, date ranges)

### ✅ OAuth Token Issue Resolution (2025-11-05)

**Fixed: Enhanced Error Handling & Diagnostics**

Previously reported syntax errors in claude.md have been resolved. The following improvements were made to address OAuth token issues:

1. **Improved OAuth Callback Error Handling** (`apps/api/src/routers/auth.ts`)
   - ✅ Added detailed error logging with Google API response bodies
   - ✅ Separate try-catch for token encryption to catch ENCRYPTION_KEY issues
   - ✅ Parse Arctic/OAuth-specific errors (invalid_grant, PKCE failures)
   - ✅ Preserve TRPCError types for proper client-side handling

2. **Enhanced Token Refresh Logic** (`apps/api/src/auth/token-refresh.ts`)
   - ✅ Parse refresh errors to identify: revoked tokens, invalid credentials, network issues
   - ✅ Separate decryption errors from refresh errors with clear error codes
   - ✅ Added detailed console logging for debugging token issues
   - ✅ Error messages now include actionable guidance (e.g., "User needs to re-authenticate")

3. **Better Google Calendar API Error Handling** (`apps/api/src/services/google-calendar.ts`)
   - ✅ Parse Google API error responses to extract detailed error messages
   - ✅ Distinguish between 401 (invalid token), 403 (permissions), 404 (not found), 429 (rate limit)
   - ✅ Handle request timeouts with AbortSignal
   - ✅ Provide specific guidance based on error type

4. **OAuth Diagnostic Tool** (`apps/api/oauth-diagnostic-tool.ts`)
   - ✅ Created comprehensive diagnostic CLI tool to check:
     - Environment variables configuration
     - Database connectivity
     - Google OAuth credentials format
     - User calendar connections and token status
     - Token encryption/decryption functionality
     - Token expiry status
   - Usage: `npx tsx apps/api/oauth-diagnostic-tool.ts [userId]`

**Remaining Environment Issues**:

- Redis using read-only user (needs read-write credentials for BullMQ)

### 🚧 Stubs Only (Not Implemented)

- `calendar.sync` - Returns placeholder, no actual sync
- `project.*` - Only empty list endpoint exists
- `timesheet.*` - Only empty getEntries exists
- Background jobs - BullMQ configured but no jobs created
- Redis caching - Not used anywhere yet

### ❌ Not Started

**Backend**

- Calendar event syncing (background jobs)
- Project CRUD operations
- Timesheet entry management
- AI categorization engine
- Session cleanup jobs
- Structured logging (currently console.log)

**Frontend**

- All UI pages (0% implemented, only scaffold exists)
- Authentication pages
- Calendar selection UI
- Timesheet views
- Project management
- Any React Router routes
- Any Zustand stores

**Testing & Deployment**

- No tests exist (0% coverage)
- No CI/CD pipelines
- No monitoring/error tracking

### Next Priorities

**Immediate** (Critical for Testing):

1. Test OAuth flow end-to-end with a real Google account
2. Update Redis to use read-write credentials for BullMQ
3. Verify calendar sync functionality works correctly

**Short Term** (Core MVP):

1. Build frontend authentication flow
2. Implement calendar sync with BullMQ
3. Create project management API + UI
4. Build timesheet entry system
5. Implement basic AI categorization

**Medium Term** (Polish):

1. Add comprehensive logging
2. Session cleanup job
3. Stricter rate limiting per endpoint
4. Password strength validation
5. Write tests for critical paths

---

## Technical Notes

### Implementation Details

**Authentication**

- Email normalization (lowercase) prevents duplicate accounts
- Session cookies: `sameSite: 'lax'` for CSRF protection
- OAuth state cookies: `sameSite: 'lax'` with 10-minute expiry
- Generic error messages prevent information disclosure
- Calendar ID validation prevents unauthorized access

**Database**

- `selectedCalendarIds` stored as JSON (simpler than separate table)
- Nullable `expiresAt` for long-lived tokens
- CASCADE deletes maintain referential integrity
- Indexes on userId, date ranges, and foreign keys

**Security Gaps to Address**

- Rate limiting: Global only, needs endpoint-specific limits
- Password strength: Only checks minimum length
- Token refresh: Potential race condition with simultaneous requests
- Logging: Using console.log instead of structured logger
- Sessions: No automated cleanup job
- Transactions: User/session creation not atomic

### Key Files

**Backend**

- `apps/api/src/routers/auth.ts` - Authentication endpoints
- `apps/api/src/routers/calendar.ts` - Calendar API
- `apps/api/src/auth/token-refresh.ts` - Token refresh service
- `apps/api/src/services/google-calendar.ts` - Google Calendar integration
- `packages/database/prisma/schema.prisma` - Database schema

**Configuration**

- `.env` - All environment variables
- `packages/config/index.ts` - App constants
