# Auto Timesheet

A personal time tracking tool that automatically syncs with Google Calendar and intelligently categorizes work time using AI-powered suggestions.

## Quick Start

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Set up the database:
```bash
pnpm db:push
```

4. Start development servers:
```bash
pnpm dev
```

## Project Structure

- `apps/web` - React frontend (Vite + TypeScript)
- `apps/api` - Fastify backend (tRPC + TypeScript)
- `packages/database` - Prisma schema and database client
- `packages/shared` - Shared types and utilities
- `packages/config` - Shared configuration

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, TanStack Query, Zustand
- **Backend**: Fastify, tRPC, Prisma, BullMQ, Redis
- **Database**: PostgreSQL
- **Monorepo**: Turborepo with pnpm workspaces

## Available Commands

See `claude.md` for a complete list of commands and development workflow.

## Documentation

For detailed project documentation, architecture decisions, and implementation guides, see `claude.md`.
