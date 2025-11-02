# Auto Timesheet - Time Tracking App

## Project Overview
A personal time tracking tool that automatically syncs with Google Calendar and intelligently categorizes work time using AI-powered suggestions, eliminating manual timesheet entry.

## Tech Stack

### Frontend
- **Framework**: React 18.x with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS 3.x
- **State Management**: 
  - Zustand for global state (user, auth, UI state)
  - TanStack Query (React Query) for server state & caching
- **Forms**: React Hook Form + Zod validation
- **UI Components**: Radix UI primitives
- **Routing**: React Router v6
- **Date Handling**: date-fns
- **HTTP Client**: tRPC client (type-safe API calls)

### Backend
- **Runtime**: Node.js 20.x LTS
- **Framework**: Fastify (high performance, TypeScript-first)
- **API Layer**: tRPC for end-to-end type safety
- **Database**: PostgreSQL 16.x with Prisma ORM
- **Caching**: Redis (via Upstash)
- **Queue**: BullMQ for background jobs
- **Authentication**: 
  - Lucia Auth for session management
  - Google OAuth 2.0 for calendar access
- **Validation**: Zod schemas (shared between frontend/backend)

### Infrastructure
- **Monorepo**: Turborepo
- **Frontend Hosting**: Vercel
- **Backend Hosting**: Railway or Fly.io
- **Database**: Railway PostgreSQL or Supabase
- **Redis**: Upstash Redis
- **Monitoring**: Sentry for error tracking
- **CI/CD**: GitHub Actions

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

## Core Features Implementation

### 1. Authentication & Calendar Connection
```typescript
// OAuth flow with Google Calendar
- Implement Lucia Auth for session management
- Store OAuth tokens encrypted in database
- Auto-refresh tokens before expiry
- Request minimal scope: calendar.readonly
```

### 2. Calendar Event Syncing
```typescript
// Background job for calendar sync
- Use BullMQ to queue sync jobs
- Fetch events via Google Calendar API
- Cache results in Redis (15-minute TTL)
- Upsert to PostgreSQL for persistence
```

### 3. AI-Powered Categorization
```typescript
// Simple rule-based learning engine
interface CategoryRule {
  id: string;
  userId: string;
  ruleType: 'title_keyword' | 'attendee_email' | 'calendar_name' | 'recurring_event';
  condition: string;
  projectId: string;
  confidenceScore: number;
  accuracy: number;
}

// Learning algorithm:
1. Extract patterns from user categorizations
2. Create/update rules based on patterns
3. Calculate confidence scores
4. Suggest categories for new events
5. Learn from user corrections
```

### 4. Database Schema

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  createdAt     DateTime @default(now())
  
  sessions      Session[]
  projects      Project[]
  entries       TimesheetEntry[]
  rules         CategoryRule[]
  calendars     CalendarConnection[]
}

model Project {
  id            String   @id @default(cuid())
  userId        String
  name          String
  isArchived    Boolean  @default(false)
  lastUsedAt    DateTime @default(now())
  useCount      Int      @default(0)
  
  user          User     @relation(fields: [userId], references: [id])
  entries       TimesheetEntry[]
  rules         CategoryRule[]
  
  @@index([userId, lastUsedAt])
}

model CalendarEvent {
  id            String   @id @default(cuid())
  googleEventId String
  userId        String
  title         String
  startTime     DateTime
  endTime       DateTime
  attendees     Json?
  isAllDay      Boolean  @default(false)
  
  user          User     @relation(fields: [userId], references: [id])
  entry         TimesheetEntry?
  
  @@unique([userId, googleEventId])
  @@index([userId, startTime])
}

model TimesheetEntry {
  id            String   @id @default(cuid())
  userId        String
  eventId       String?  @unique
  projectId     String?
  date          DateTime
  duration      Int      // in minutes
  isManual      Boolean  @default(false)
  isSkipped     Boolean  @default(false)
  notes         String?
  
  user          User     @relation(fields: [userId], references: [id])
  event         CalendarEvent? @relation(fields: [eventId], references: [id])
  project       Project? @relation(fields: [projectId], references: [id])
  
  @@index([userId, date])
}

model CategoryRule {
  id            String   @id @default(cuid())
  userId        String
  ruleType      String
  condition     String
  projectId     String
  confidence    Float    @default(0.5)
  matchCount    Int      @default(0)
  accuracy      Float    @default(0)
  
  user          User     @relation(fields: [userId], references: [id])
  project       Project  @relation(fields: [projectId], references: [id])
  
  @@index([userId, ruleType])
}
```

## API Endpoints (tRPC Procedures)

```typescript
// Auth procedures
auth.signup
auth.login  
auth.logout
auth.googleOAuth
auth.googleCallback

// Calendar procedures  
calendar.list
calendar.sync
calendar.updateSettings

// Event procedures
event.getRange
event.getSuggestions

// Project procedures
project.list
project.create
project.update
project.archive

// Timesheet procedures
timesheet.getEntries
timesheet.updateEntry
timesheet.createManualEntry
timesheet.skipEntry
timesheet.bulkCategorize

// Learning procedures
learning.provideFeedback
learning.getStats
```

## Key Implementation Details

### 1. Optimistic Updates
- Use React Query's optimistic updates for instant UI feedback
- Rollback on server errors
- Show subtle loading states

### 2. Background Jobs
```typescript
// Calendar sync job (runs every 15 minutes)
queue.add('sync-calendar', { userId }, {
  repeat: { every: 900000 } // 15 minutes
});

// Learning feedback job
queue.add('update-rules', { 
  userId, 
  eventId, 
  selectedProjectId 
});
```

### 3. Performance Optimizations
- Lazy load older weeks
- Virtual scrolling for large lists
- Debounced auto-save (500ms)
- Redis caching for frequently accessed data
- Database indexes on foreign keys and date ranges

### 4. Security Considerations
- Encrypt OAuth tokens at rest
- Use httpOnly, secure, sameSite cookies
- Rate limiting (100 requests/minute)
- Input validation with Zod
- SQL injection prevention via Prisma
- CORS configuration for production domain only

## Development Workflow

### Local Development Setup
```bash
# Clone repository
git clone <repo-url>
cd auto-timesheet

# Install dependencies
pnpm install

# Setup environment variables
cp .env.example .env.local
# Add Google OAuth credentials, database URL, etc.

# Run database migrations
pnpm db:migrate

# Start development servers
pnpm dev
```

### Environment Variables
```env
# Database
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."

# Auth
SESSION_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GOOGLE_REDIRECT_URI="..."

# Encryption
ENCRYPTION_KEY="..."

# API
API_URL="http://localhost:3001"
NEXT_PUBLIC_API_URL="http://localhost:3001"
```

## Testing Strategy

### Unit Tests
- Vitest for frontend components
- Jest for backend services
- Test coverage target: 70% for critical paths

### Integration Tests
- Test API endpoints with supertest
- Test database operations with test database

### E2E Tests (Post-MVP)
- Playwright for critical user flows
- Test calendar sync, categorization, and time tracking

## Deployment Checklist

### Pre-deployment
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Redis configured
- [ ] Google OAuth app configured
- [ ] CORS settings updated
- [ ] Rate limiting configured

### Monitoring Setup
- [ ] Sentry error tracking
- [ ] Uptime monitoring
- [ ] Database query performance monitoring
- [ ] API endpoint latency tracking

## Performance Targets
- Page load: < 2 seconds
- API response: < 500ms (p95)
- Calendar sync: < 5 seconds for 1 week
- Suggestion accuracy: > 60% after 3 weeks
- User retention: 3+ consecutive weeks

## Success Metrics (SCL)
- User completes first weekly review in < 5 minutes from signup
- AI suggestion accuracy > 60% acceptance rate  
- User returns for 3+ consecutive weeks
- 8/10 beta users would recommend to colleague

## Future Enhancements (Post-MVP)
- Export functionality (CSV, PDF reports)
- Team features and shared projects
- Mobile app (React Native)
- Integration with other calendar providers
- Advanced AI using ML models
- Webhook integrations with timesheet systems
- Multi-language support

## Common Commands

```bash
# Development
pnpm dev              # Start all services
pnpm dev:web          # Start frontend only
pnpm dev:api          # Start backend only

# Database
pnpm db:push          # Push schema changes
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Prisma Studio

# Testing
pnpm test             # Run all tests
pnpm test:unit        # Run unit tests
pnpm test:e2e         # Run E2E tests

# Building
pnpm build            # Build all packages
pnpm build:web        # Build frontend
pnpm build:api        # Build backend

# Deployment
pnpm deploy:staging   # Deploy to staging
pnpm deploy:prod      # Deploy to production
```

## Architecture Decisions

### Why Fastify over Express?
- 2x faster performance
- Built-in TypeScript support
- Schema-based validation
- Better plugin ecosystem

### Why tRPC?
- End-to-end type safety
- No API documentation needed
- Automatic client generation
- Perfect for TypeScript monorepos

### Why Zustand over Context API?
- Less boilerplate
- Better performance (no unnecessary re-renders)
- DevTools support
- Simpler async actions

### Why BullMQ for background jobs?
- Redis-based reliability
- Job retries and scheduling
- Dashboard for monitoring
- Handles calendar sync perfectly

### Why Lucia Auth?
- Modern, type-safe authentication
- Built for TypeScript
- Flexible session management
- Works great with OAuth

## Getting Help

- Review the PRD for detailed requirements
- Check the database schema for data relationships
- Use the tRPC procedures as your API guide
- Follow the SCL principle: Simple, Complete, Lovable
- Prioritize user experience over features

## Important Notes

1. **Start with the MVP**: Focus on core calendar sync and categorization first
2. **Keep it simple**: No exports, no team features for initial release
3. **Make it fast**: Users should complete weekly review in < 5 minutes
4. **AI learning**: Simple rule-based system is sufficient for MVP
5. **User-first**: Every decision should reduce friction for the user

This project follows the SCL (Simple, Complete, Lovable) philosophy - build something simple that works completely and that users will love.

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

### Completed
- [x] Basic project structure created
- [x] Turborepo monorepo setup
- [x] Frontend app scaffolding (React + Vite + Tailwind)
- [x] Backend API scaffolding (Fastify + tRPC)
- [x] Prisma database schema defined
- [x] Shared packages structure (database, shared, config)
- [x] Basic tRPC router structure with placeholder endpoints

### In Progress
- [ ] Google OAuth authentication
- [ ] Calendar sync functionality
- [ ] Project management features
- [ ] Timesheet entry system
- [ ] AI categorization engine

### Next Steps
1. Set up Google OAuth authentication flow
2. Implement Lucia Auth for session management
3. Create calendar sync service with Google Calendar API
4. Build timesheet UI components
5. Implement rule-based learning engine for categorization
