# RM API Integration Documentation

## Overview

Integration with Resource Management (RM) by Smartsheet for syncing timesheet entries. Uses a **service account model** where one API token can create time entries for multiple users.

**Key Features:**
- Sync timesheet entries to RM with one click
- Service account architecture (one token for all users)
- Smart sync: creates, updates, and skips entries based on change detection
- Hash-based change detection (only syncs when hours/notes change)
- Project mapping system
- Comprehensive error handling and retry logic

---

## Architecture

### Service Account Model

Instead of each user having their own RM API token, the system uses a **single service account token** (typically from an admin user) and creates time entries for different users by specifying the `user_id` parameter in the RM API.

**Components:**
1. **RMConnection** - Single connection per organization with encrypted token
2. **User.rmUserId** - Each user has their RM user ID in their profile
3. **Sync Service** - Uses service token + user's RM user ID to create entries

**Benefits:**
- Easier onboarding (users don't need their own tokens)
- Centralized token management
- Single point of configuration

---

## Database Schema

### RMConnection Model
```prisma
model RMConnection {
  id               String   @id @default(cuid())
  userId           String   @unique  // Time-tracker user (connection owner)

  // Encrypted API token (AES-256-GCM)
  encryptedToken   String
  tokenIv          String
  tokenAuthTag     String

  // RM user info (token owner, typically admin/service account)
  rmUserId         Int
  rmUserEmail      String
  rmUserName       String?

  // Sync configuration
  autoSyncEnabled  Boolean  @default(false)
  lastSyncAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // Relations
  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectMappings  RMProjectMapping[]
  syncLogs         RMSyncLog[]
}
```

### User Model (RM Fields)
```prisma
model User {
  id             String   @id @default(cuid())
  email          String   @unique
  name           String?
  rmUserId       Int?     // RM user ID for this user (used when creating time entries)
  // ... other fields
}
```

### RMProjectMapping Model
```prisma
model RMProjectMapping {
  id            String   @id @default(cuid())
  connectionId  String
  projectId     String   // Local project ID
  rmProjectId   Int      // RM project ID
  enabled       Boolean  @default(true)

  connection    RMConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  project       Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([connectionId, projectId])
}
```

### RMSyncedEntry Model
```prisma
model RMSyncedEntry {
  id               String   @id @default(cuid())
  mappingId        String
  timesheetEntryId String   @unique
  rmEntryId        BigInt   // RM's time entry ID (BigInt for IDs > 2 billion)
  lastSyncedAt     DateTime
  lastSyncedHash   String   // SHA-256 hash for change detection
  syncVersion      Int      @default(1)

  mapping          RMProjectMapping @relation(fields: [mappingId], references: [id], onDelete: Cascade)
  timesheetEntry   TimesheetEntry   @relation(fields: [timesheetEntryId], references: [id], onDelete: Cascade)
}
```

### RMSyncLog Model
```prisma
model RMSyncLog {
  id              String        @id @default(cuid())
  connectionId    String
  status          RMSyncStatus  // RUNNING, COMPLETED, PARTIAL, FAILED
  fromDate        DateTime
  toDate          DateTime
  entriesAttempted Int          @default(0)
  entriesSuccess   Int          @default(0)
  entriesFailed    Int          @default(0)
  entriesSkipped   Int          @default(0)
  errorMessage     String?
  errorDetails     Json?
  startedAt        DateTime     @default(now())
  completedAt      DateTime?

  connection      RMConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  // Partial unique index - only one RUNNING sync per connection
  @@unique([connectionId], where: { status: "RUNNING" })
}
```

---

## Setup Instructions

### 1. Initial Setup (One-Time)

**Prerequisites:**
- RM account with admin access
- Personal API token from RM

**Steps:**

1. **Get Service Account Token:**
   ```bash
   # Log in to RM as admin/service account user
   # Go to: Settings → Developer API → Generate Token
   # Copy the token
   ```

2. **Add Token to .env:**
   ```bash
   RM_API_KEY=your_token_here
   ```

3. **Run Setup Script:**
   ```bash
   cd apps/api
   npx tsx ../../setup-rm-service-account.ts "YOUR_RM_TOKEN" YOUR_RM_USER_ID
   ```

   Example:
   ```bash
   npx tsx ../../setup-rm-service-account.ts "abc123xyz" 1030131
   ```

   This script:
   - Verifies the token
   - Creates encrypted RMConnection
   - Sets your RM user ID in your user profile

### 2. Per-User Setup

Each user needs to set their RM user ID:

1. **Find Your RM User ID:**
   - Log in to https://app.rm.smartsheet.com
   - Go to Settings → My Profile
   - Find your user ID (in URL or profile)

2. **Set in Time Tracker:**
   - Go to Settings page (http://localhost:3000/settings)
   - Enter your RM user ID in "Your Profile" section
   - Click "Update"

### 3. Project Mapping

Map local projects to RM projects:

1. Go to Settings → "Manage Project Mappings"
2. For each local project, select the corresponding RM project
3. Save mappings

---

## API Endpoints

### Connection Management

#### Get Connection
```typescript
trpc.rm.connection.get.useQuery()

// Returns:
{
  id: string
  rmUserId: number
  rmUserEmail: string
  rmUserName: string | null
  lastSyncAt: Date | null
  createdAt: Date
}
```

#### Create Connection
```typescript
trpc.rm.connection.create.useMutation({
  apiToken: string
})

// Returns: Connection object
```

#### Delete Connection
```typescript
trpc.rm.connection.delete.useMutation()

// Cascades to: project mappings, synced entries, sync logs
```

### Project Mapping

#### List Mappings
```typescript
trpc.rm.projectMapping.list.useQuery()

// Returns:
{
  id: string
  projectId: string
  rmProjectId: number
  enabled: boolean
  project: { id, name, color }
  rmProject: { id, name, client_name }
}[]
```

#### Get RM Projects
```typescript
trpc.rm.projectMapping.getRMProjects.useQuery()

// Returns: List of all RM projects
```

#### Create/Update Mapping
```typescript
trpc.rm.projectMapping.upsert.useMutation({
  projectId: string
  rmProjectId: number | null  // null to remove mapping
})
```

#### Toggle Mapping
```typescript
trpc.rm.projectMapping.toggle.useMutation({
  mappingId: string
  enabled: boolean
})
```

### Sync Operations

#### Preview Sync
```typescript
trpc.rm.sync.preview.useQuery({
  fromDate: string  // YYYY-MM-DD
  toDate: string    // YYYY-MM-DD
})

// Returns:
{
  totalEntries: number
  toCreate: number
  toUpdate: number
  toSkip: number
  unmappedProjects: Array<{ id, name }>
  entries: Array<{
    timesheetEntryId: string
    projectName: string
    date: string
    hours: number
    action: 'create' | 'update' | 'skip'
    reason?: string
  }>
}
```

#### Execute Sync
```typescript
trpc.rm.sync.execute.useMutation({
  fromDate: string  // YYYY-MM-DD
  toDate: string    // YYYY-MM-DD
})

// Returns:
{
  syncLogId: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  entriesAttempted: number
  entriesSuccess: number
  entriesFailed: number
  entriesSkipped: number
  errors?: Array<{ entryId: string, error: string }>
}
```

#### Get Sync History
```typescript
trpc.rm.sync.history.useQuery({
  limit?: number  // Default: 10
})

// Returns: Array of sync logs
```

### User Profile

#### Update RM User ID
```typescript
trpc.auth.updateRMUserId.useMutation({
  rmUserId: number | null
})
```

---

## Sync Logic

### Flow

1. **Initiation:**
   - User clicks "Sync to RM" on Timesheet Grid
   - Creates RUNNING sync log (prevents concurrent syncs)

2. **Validation:**
   - Check RM connection exists
   - Check user has rmUserId set
   - Fetch project mappings
   - Fetch timesheet entries for date range

3. **Per-Entry Processing:**
   ```
   FOR each timesheet entry:
     IF hours == 0:
       SKIP (zero hours)

     IF project not mapped:
       SKIP (unmapped project)

     Calculate hash = SHA256(date + hours + notes)

     IF already synced AND hash matches:
       SKIP (no changes)

     IF already synced AND hash differs:
       UPDATE RM entry
       UPDATE RMSyncedEntry (new hash, increment version)

     ELSE:
       CREATE RM entry
       CREATE RMSyncedEntry

     Wait 100ms (rate limiting)
   ```

4. **Completion:**
   - Mark sync log as COMPLETED/PARTIAL/FAILED
   - Return statistics

### Change Detection

Uses SHA-256 hash of `date + hours + notes`:

```typescript
function calculateEntryHash(date: Date, hours: number, notes?: string): string {
  const content = `${date.toISOString().split('T')[0]}|${hours}|${notes || ''}`
  return createHash('sha256').update(content).digest('hex')
}
```

**Sync Behavior:**
- Hash matches → Skip (already synced, no changes)
- Hash differs → Update (hours or notes changed)
- No hash → Create (first sync)

### Error Handling

**Rate Limiting:**
- 100ms delay between API calls
- Single retry with 2-second delay on 429 error

**Not Found (404):**
- Automatically disables project mapping
- Entry marked as failed with reason

**Network/Validation Errors:**
- Entry marked as failed
- Detailed error logged
- Sync continues with next entry

**Catastrophic Errors:**
- Try-catch-finally ensures sync log is always completed
- Prevents stuck RUNNING syncs

---

## RM API Reference

### Base URL
```
https://api.rm.smartsheet.com/api/v1
```

### Authentication
```http
Authorization: Bearer YOUR_API_TOKEN
```

### Key Endpoints Used

#### Get Users
```http
GET /users?page=1
```

Response:
```json
{
  "data": [{
    "id": 74618,
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe"
  }]
}
```

#### Get Projects
```http
GET /projects?page=1&per_page=1000
```

Response:
```json
{
  "data": [{
    "id": 12345,
    "name": "Project Name",
    "code": "PROJ",
    "client_name": "Client Name",
    "archived": false
  }]
}
```

#### Create Time Entry
```http
POST /users/{userId}/time_entries
Content-Type: application/json

{
  "date": "2025-12-10",
  "hours": 8.5,
  "assignable_id": 12345,
  "notes": "Development work"
}
```

Response:
```json
{
  "id": 26107271550,
  "user_id": 1030131,
  "assignable_id": 12345,
  "date": "2025-12-10",
  "hours": 8.5,
  "notes": "Development work"
}
```

**CRITICAL:** RM entry IDs can exceed INT4 max (2,147,483,647). Always use `BigInt` in database schema.

#### Update Time Entry
```http
PUT /users/{userId}/time_entries/{entryId}
Content-Type: application/json

{
  "hours": 7.5,
  "notes": "Updated notes"
}
```

---

## Key Files

### Backend

**Services:**
- `apps/api/src/services/rm-api.ts` - Low-level RM API client
- `apps/api/src/services/rm-sync.ts` - Sync orchestration logic
- `apps/api/src/auth/rm-encryption.ts` - Token encryption/decryption

**Routers:**
- `apps/api/src/routers/rm.ts` - Connection, mapping, and sync endpoints
- `apps/api/src/routers/auth.ts` - User RM user ID endpoint

**Schema:**
- `packages/database/prisma/schema.prisma` - RMConnection, RMProjectMapping, RMSyncedEntry, RMSyncLog models

### Frontend

**Pages:**
- `apps/web/src/pages/Settings.tsx` - Connection setup + RM user ID
- `apps/web/src/pages/RMProjectMapping.tsx` - Project mapping UI
- `apps/web/src/pages/TimesheetGrid.tsx` - Sync button integration

**Components:**
- `apps/web/src/components/RMSyncButton.tsx` - Sync modal with preview

### Utilities

**Scripts:**
- `setup-rm-service-account.ts` - One-time setup script
- `check-rm-connection.ts` - Verify connection exists
- `cleanup-stuck-sync.ts` - Fix stuck RUNNING syncs

---

## Troubleshooting

### "No RM connection found"

**Cause:** No RMConnection record for user

**Fix:**
```bash
npx tsx setup-rm-service-account.ts "YOUR_TOKEN" YOUR_USER_ID
```

### "RM user ID not set"

**Cause:** User.rmUserId is null

**Fix:**
1. Go to Settings page
2. Enter your RM user ID
3. Click Update

### "Sync operation is already in progress"

**Cause:** Previous sync left in RUNNING state

**Fix:**
```bash
npx tsx cleanup-stuck-sync.ts
```

Or manually:
```sql
UPDATE "RMSyncLog"
SET status = 'FAILED',
    "errorMessage" = 'Sync cancelled: stuck in RUNNING state',
    "completedAt" = NOW()
WHERE status = 'RUNNING';
```

### "Project not mapped to RM"

**Cause:** Local project has no RM project mapping

**Fix:**
1. Go to Settings → Manage Project Mappings
2. Select RM project for the local project
3. Save

### "Unable to fit integer value into INT4"

**Cause:** RM entry ID exceeds 2,147,483,647

**Fix:** Already fixed - `rmEntryId` is now `BigInt` in schema

### "Cached plan must not change result type"

**Cause:** Neon PostgreSQL pooler cached old schema

**Fix:**
1. Wait 5-10 minutes for pooler timeout, OR
2. Restart API server (`pnpm dev`), OR
3. Use direct connection (remove `-pooler` from DATABASE_URL)

---

## Configuration

### Environment Variables

```bash
# Required
RM_API_KEY=your_rm_api_token_here

# Optional (already configured)
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=32_byte_hex_string
```

### Sync Settings

**Rate Limiting:**
- Delay between API calls: 100ms
- Max requests per sync: Unlimited
- Retry on rate limit: 1 attempt with 2-second delay

**Change Detection:**
- Algorithm: SHA-256
- Fields: date + hours + notes

**Sync Scope:**
- By default: Current week (Monday-Sunday)
- Configurable: Any date range

---

## Best Practices

### For Administrators

1. **Use a dedicated service account** for the API token
2. **Rotate tokens periodically** (every 90 days)
3. **Monitor sync logs** for failures
4. **Review project mappings** regularly

### For Users

1. **Set your RM user ID immediately** after account creation
2. **Map all projects** you work on
3. **Review preview** before executing sync
4. **Check RM** after sync to verify entries
5. **Don't sync the same week multiple times** (use preview first)

### For Developers

1. **Always use BigInt** for external API IDs
2. **Implement retry logic** for rate limits
3. **Use hash-based change detection** to avoid unnecessary updates
4. **Log all sync operations** for debugging
5. **Handle errors gracefully** - don't leave stuck syncs

---

## Future Enhancements

**Potential Features:**
- [ ] Background sync jobs (requires Redis write access)
- [ ] Bi-directional sync (pull changes from RM)
- [ ] Selective sync (choose specific entries)
- [ ] Auto-sync on save
- [ ] Conflict resolution for concurrent edits
- [ ] Bulk operations (sync multiple weeks)
- [ ] Sync scheduling (auto-sync Friday EOD)
- [ ] Real-time progress tracking
- [ ] Detailed audit logs
- [ ] Multi-organization support

---

## Support

**Documentation:**
- RM API Docs: https://help.smartsheet.com/articles/2482468-resource-management-api
- This file: `docs/RM_API.md`

**Common Issues:**
- See Troubleshooting section above
- Check sync logs: `trpc.rm.sync.history.useQuery()`
- Review error details in browser console

**Contact:**
- For RM API issues: https://help.smartsheet.com
- For integration bugs: Create GitHub issue

---

## Changelog

### 2025-12-11 - Service Account Model
- ✅ Added `User.rmUserId` field
- ✅ Changed sync to use logged-in user's RM user ID
- ✅ Updated Settings page with RM user ID input
- ✅ Created setup script for service account configuration
- ✅ Fixed BigInt overflow for RM entry IDs
- ✅ Added comprehensive error handling
- ✅ Implemented fail-safe sync completion

### 2025-12-10 - Initial Implementation
- ✅ Complete RM API integration (Phase 3)
- ✅ Sync preview and execution
- ✅ Project mapping system
- ✅ Hash-based change detection
- ✅ Error handling and retry logic
- ✅ Frontend sync button with modal

---

**Last Updated:** December 11, 2025
