# Auto Timesheet - Time Tracking App

## Project Overview
A personal time tracking tool that automatically syncs with Google Calendar and intelligently categorizes work time using AI-powered suggestions, eliminating manual timesheet entry.

## Tech Stack

**Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, Zustand + TanStack Query, React Hook Form + Zod, Radix UI, React Router v6, tRPC client

**Backend:** Node.js 20.x + Fastify, tRPC, PostgreSQL + Prisma ORM, Redis (Upstash), BullMQ, Lucia Auth + Google OAuth 2.0, Zod validation

**Infrastructure:** Turborepo monorepo, Neon PostgreSQL, Upstash Redis, Vercel (frontend), Railway/Fly.io (backend planned)

## Project Structure

```
auto-timesheet/
├── apps/
│   ├── web/          # React frontend (components, pages, hooks, lib, stores)
│   └── api/          # Fastify backend (routers, services, jobs, auth, db)
├── packages/
│   ├── database/     # Shared Prisma schema
│   ├── shared/       # Shared types & utilities
│   └── config/       # Shared configs (AI_CONFIG, API constants)
└── docs/             # AI_ENGINE.md, API.md, TESTING.md
```

## Core Features (MVP Scope)

1. **User Authentication** - Email/password (Argon2) + Google OAuth with encrypted token storage (AES-256-GCM), automatic token refresh, Lucia Auth sessions
2. **Calendar Integration** - List/select Google calendars, fetch events via API, store with metadata, timezone detection
3. **Time Tracking** - Automatic timesheet entries from calendar events, manual entry creation, project categorization, weekly grid view
4. **AI Categorization** - Rule-based learning from user patterns (title keywords, attendee emails, calendar source, recurring events), 60%+ accuracy target

## Database Schema

See `packages/database/prisma/schema.prisma`. Key models: User, Session, CalendarConnection, CalendarEvent, Project, TimesheetEntry, CategoryRule (AI learning), SuggestionLog (analytics).

## Security

- OAuth tokens: AES-256-GCM encryption at rest
- Sessions: httpOnly, sameSite cookies (CSRF protection)
- Rate limiting: 100 req/min global
- Input validation: Zod schemas on all endpoints
- Password hashing: Argon2 (OWASP recommended)

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
See `.env`: DATABASE_URL (Neon), REDIS_URL (Upstash), SESSION_SECRET, ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

### Database Commands
```bash
pnpm db:push          # Push schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio
pnpm db:seed          # Seed AI test data
```

## Success Metrics (MVP)
- User completes first weekly review in < 5 minutes
- AI suggestion accuracy > 60% after 3 weeks
- 3+ weeks user retention
- 8/10 beta users recommend to colleague

## Architecture Decisions

- **Fastify** over Express: 2x faster, TypeScript-first
- **tRPC**: End-to-end type safety, no API docs needed
- **Zustand**: Less boilerplate than Context API
- **BullMQ**: Redis-based reliability for calendar sync
- **Lucia Auth**: Modern, type-safe session management
- **Argon2**: OWASP recommended over bcrypt
- **AES-256-GCM**: Authenticated encryption prevents tampering

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
1. Read this CLAUDE.md file to understand current project state
2. Review recent changes and understand what has been implemented
3. Check project structure and existing features
4. Understand current development priorities and MVP scope

### Session End Protocol
1. Re-read this CLAUDE.md file
2. Update relevant sections: new features, architecture changes, API endpoints, schema changes, workflow modifications
3. Add notes about technical decisions made during the session
4. Update "Current Status" section with what was completed

### Maintaining Context
- This file is the source of truth for project architecture and decisions
- Keep it concise but comprehensive
- Document deviations from the original plan
- Note blockers or technical challenges
- Update checklist items as they are completed

---

## Current Status

### ✅ Completed Features

**Infrastructure & Core Backend**
- Turborepo monorepo with pnpm workspaces
- Neon PostgreSQL deployed with all 8 models (User, Session, CalendarConnection, CalendarEvent, Project, TimesheetEntry, CategoryRule, SuggestionLog)
- Email/password auth (Argon2) + Google OAuth with PKCE flow (Arctic)
- Lucia Auth session management with httpOnly/sameSite cookies
- Token encryption (AES-256-GCM) and auto-refresh
- Rate limiting (100 req/min global)
- Background calendar sync jobs with BullMQ

**Calendar Integration**
- List/select Google calendars with pagination
- Google Calendar service (fetch events with error handling)
- Manual and background sync endpoints
- Event storage with soft delete, multi-day event splitting
- Automatic timezone detection from Google Calendar (stores IANA timezone per user)
- Event filtering: excludes cancelled, excludes user declined, handles tentative status

**Project Management (Epic 3)**
- Complete project CRUD API: list (filtering, sorting, search), create, update, archive
- Input validation (HTML sanitization, duplicate prevention, ownership verification)
- Usage tracking (useCount, lastUsedAt)
- ProjectPicker component with type-ahead search, inline creation, keyboard navigation (Cmd/K)
- Projects management page: table view, search, sort, inline edit, archive/unarchive
- React Query caching (5-min staleTime)

**Timesheet Categorization**
- Events page: categorization hub with auto-save on project selection
- Visual states: green checkmark (categorized), gray background (skipped)
- Timesheet grid: weekly spreadsheet view (projects × days)
- Editable hour cells (15-min increments), expandable notes field
- Daily totals row (red when < 7.5hrs), weekly totals column
- Week navigation (Prev/Next/This Week)
- Real-time grid refresh via React Query invalidation

**Frontend UI**
- Login/signup pages with email/password and Google OAuth
- Protected routes with session validation
- Events page with date range selector, calendar onboarding, event categorization
- Timesheet grid page with editable cells
- Projects management page
- Navigation: Events → Timesheet → Projects
- Auto-refresh (15 min intervals when tab active)

**Shared Packages**
- Zod schemas for validation
- Config constants (API, calendar, AI settings)
- Utility functions (duration, date ranges, overlap detection)

### ✅ Critical Bug Fixes & Improvements

**OAuth & Session Management (2025-11-05)**
- **Fix:** Vite proxy configuration (`/trpc` and `/auth` → port 3001) enables same-origin cookies
- **Fix:** Refresh token preservation (only update if Google provides new one)
- **Fix:** Auto-logout on refresh failure (invalidates sessions when token revoked)
- Error handling: OAuth callback, token refresh, Google Calendar API
- OAuth diagnostic tool: `npx tsx apps/api/oauth-diagnostic-tool.ts [userId]`

**Timezone Detection (2025-11-06)**
- **Fix:** Automatic timezone detection from Google Calendar during OAuth (stores IANA timezone)
- **Fix:** `getUserLocalNow()` bug - now returns actual UTC time instead of treating local time as UTC
- Calendar sync uses user timezone to determine which events have ended
- Diagnostic: `npx tsx apps/api/debug-timezone.ts [userId]`

### 📋 AI Suggestion Engine - Phase 0 Complete (2025-01-09)

**Status:** Infrastructure ready. See `docs/AI_ENGINE.md` for complete 10-phase roadmap.

**Schema & Data:**
- Enhanced `CategoryRule` model: `confidenceScore`, `totalSuggestions`, `lastMatchedAt`
- Added `SuggestionLog` table (tracks ACCEPTED/REJECTED/IGNORED outcomes)
- 5 rule types: TITLE_KEYWORD, ATTENDEE_EMAIL, ATTENDEE_DOMAIN, CALENDAR_NAME, RECURRING_EVENT_ID
- Migration ready: `packages/database/prisma/migrations/20250109_ai_suggestion_engine/`
- Seed script: `pnpm db:seed` (9 sample rules)

**Code:**
- AI service stub: `apps/api/src/services/ai-categorization.ts` (documented, not implemented)
- Test suite: `apps/api/src/services/__tests__/ai-categorization.test.ts` (skeleton tests)
- Documentation: `docs/AI_ENGINE.md`, `docs/API.md`, `docs/TESTING.md`

**Architecture:**
- 50% confidence threshold (AI_CONFIG.minConfidenceThreshold)
- 10-phase incremental implementation (Phase 1 complete, Phase 2-10 pending)
- Success target: 60%+ accuracy after 3-4 weeks

**Next:** Phase 2 - Pattern extraction functions

---

### 🚧 Partially Implemented

- **Background jobs** - BullMQ configured, jobs created, but Redis needs read-write access
- **Redis caching** - Not used anywhere yet
- **AI categorization** - Schema and stubs ready, implementation pending

### ❌ Not Started

**Backend:** Session cleanup jobs, structured logging (using console.log), token refresh race condition handling

**Frontend:** Settings page, manual time entry UI

**Testing & Deployment:** No tests (0% coverage), no CI/CD, no monitoring/error tracking

### Next Priorities

**Immediate (Critical for MVP):**
1. Update Redis to read-write credentials for BullMQ
2. Implement AI categorization engine (Phases 2-6)
3. Add OAuth token refresh failure UI notifications

**Medium Term (Polish):**
1. Structured logging, session cleanup job
2. Stricter rate limiting per endpoint
3. Password strength validation
4. Write tests for critical paths
5. Manual time entry UI, settings page

---

## Technical Notes

### Implementation Details

**Authentication:**
- Email normalization (lowercase), session cookies (sameSite: lax via Vite proxy)
- OAuth state: in-memory Map with 10-min expiry
- Generic error messages prevent info disclosure
- Vite proxy enables same-origin cookies during development

**Calendar Sync & Event Filtering:**
- **Past events only:** endTime < now, fetches from start of current week
- **Filtering:** excludes cancelled, excludes user declined, includes other attendee declined
- **Multi-day events:** timed events split into daily segments with `splitIndex`, all-day events remain single records
- **Pagination:** maxResults 2500 per request
- **Attendee status:** marks tentative if any attendee tentative

**Database:**
- `selectedCalendarIds` stored as JSON
- CASCADE deletes for referential integrity
- Indexes on userId, date ranges, foreign keys
- `splitIndex` tracks multi-day segments (0 = single-day or first segment)

**Security Gaps to Address:**
- Rate limiting: global only, needs endpoint-specific
- Password strength: only checks min length
- Token refresh: potential race condition
- Logging: console.log instead of structured logger
- Sessions: no automated cleanup
- Transactions: user/session creation not atomic

### Key Files Reference

**Backend:** `apps/api/src/routers/` (auth, calendar, project, timesheet), `apps/api/src/services/` (google-calendar, calendar-sync, ai-categorization), `apps/api/src/auth/` (lucia, google, encryption, password, token-refresh), `packages/database/prisma/schema.prisma`

**Frontend:** `apps/web/src/pages/` (Login, Signup, Events, TimesheetGrid, Projects), `apps/web/src/components/` (ProtectedRoute, ProjectPicker, EventList), `apps/web/vite.config.ts` (proxy config)

**Config:** `.env`, `packages/config/index.ts` (AI_CONFIG)

**Docs:** `CLAUDE.md` (this file), `docs/AI_ENGINE.md`, `docs/API.md`, `docs/TESTING.md`
