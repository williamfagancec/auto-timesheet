# RM Integration - Implementation Progress

## Overview

Integration with Resource Management by Smartsheet (RM) to enable users to sync their time-tracker timesheet entries to RM automatically.

**Integration Type:** One-way push (time-tracker → RM)
**Sync Trigger:** Manual (user-initiated)
**Timeline:** Phase 1 complete, Phase 2-3 in progress

---

## Phase 1: RM Connection & Authentication ✅ COMPLETE

**Status:** Fully implemented and ready for testing
**Date Completed:** 2025-01-13

### Features Implemented

1. **Database Schema**
   - Per-user RM API token storage with AES-256-GCM encryption
   - Project mapping (time-tracker projects → RM projects)
   - Sync state tracking (which entries have been synced)
   - Sync history logging (success/failure tracking)

2. **Backend Services**
   - RM API client with comprehensive error handling
   - Connection management (create, validate, delete)
   - Token encryption/decryption matching Google OAuth pattern
   - Rate limit detection and error classification

3. **Frontend UI**
   - Settings page with RM connection form
   - Token input with show/hide toggle
   - Connection status display
   - Navigation integration

### Files Created

**Backend:**
```
apps/api/src/
├── auth/
│   └── rm-encryption.ts              [NEW] Token encryption service
├── services/
│   ├── rm-api.ts                      [NEW] RM API HTTP client
│   └── rm-connection.ts               [NEW] Connection management service
└── routers/
    └── rm.ts                          [NEW] tRPC router for RM endpoints
```

**Frontend:**
```
apps/web/src/
└── pages/
    └── Settings.tsx                   [NEW] Settings page with RM integration
```

**Database:**
```
packages/database/prisma/
└── schema.prisma                      [MODIFIED] Added 4 models + 2 enums
```

### Files Modified

1. **`packages/database/prisma/schema.prisma`**
   - Added `RMConnection`, `RMProjectMapping`, `RMSyncedEntry`, `RMSyncLog` models
   - Added `RMSyncStatus`, `RMSyncDirection` enums
   - Updated `User`, `Project`, `TimesheetEntry` relations

2. **`apps/api/src/routers/index.ts`**
   - Registered `rmRouter` in main app router

3. **`apps/web/src/App.tsx`**
   - Imported `Settings` page
   - Added `/settings` route with protected route wrapper

4. **`apps/web/src/components/Layout.tsx`**
   - Added "Settings" navigation link

### Database Schema

#### RMConnection Table
```prisma
model RMConnection {
  id               String   @id @default(cuid())
  userId           String   @unique

  // Encrypted API token (AES-256-GCM)
  encryptedToken   String
  tokenIv          String
  tokenAuthTag     String

  // RM user info
  rmUserId         Int
  rmUserEmail      String
  rmUserName       String?

  // Sync configuration
  autoSyncEnabled  Boolean  @default(false)
  lastSyncAt       DateTime?

  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

#### RMProjectMapping Table
```prisma
model RMProjectMapping {
  id                String   @id @default(cuid())
  connectionId      String
  projectId         String    // time-tracker project
  rmProjectId       Int       // RM project ID
  rmProjectName     String
  rmProjectCode     String?
  enabled           Boolean  @default(true)
  lastSyncedAt      DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([connectionId, projectId])
  @@unique([connectionId, rmProjectId])
}
```

#### RMSyncedEntry Table
```prisma
model RMSyncedEntry {
  id                String   @id @default(cuid())
  mappingId         String
  timesheetEntryId  String   @unique
  rmEntryId         Int
  rmEntryUrl        String?
  lastSyncedAt      DateTime
  lastSyncedHash    String   // Hash of (date + hours + notes)
  syncVersion       Int      @default(1)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

#### RMSyncLog Table
```prisma
model RMSyncLog {
  id               String         @id @default(cuid())
  connectionId     String
  jobId            String?
  status           RMSyncStatus
  direction        RMSyncDirection
  entriesAttempted Int            @default(0)
  entriesSuccess   Int            @default(0)
  entriesFailed    Int            @default(0)
  entriesSkipped   Int            @default(0)
  errorMessage     String?        @db.Text
  errorDetails     Json?
  startedAt        DateTime       @default(now())
  completedAt      DateTime?
}
```

### API Endpoints

All endpoints under `rm.*` namespace:

#### Connection Management

**`rm.connection.create`** (mutation)
- Input: `{ apiToken: string }`
- Validates token with RM API
- Encrypts and stores token
- Returns: `{ success: true, connection: { id, rmUserId, rmUserEmail, rmUserName, createdAt } }`
- Errors: `BAD_REQUEST` if invalid token

**`rm.connection.get`** (query)
- Returns current connection or `null`
- Output: `{ id, rmUserId, rmUserEmail, rmUserName, autoSyncEnabled, lastSyncAt, createdAt, updatedAt }`

**`rm.connection.validate`** (query)
- Checks if stored token is still valid with RM API
- Returns: `{ isValid: boolean }`

**`rm.connection.delete`** (mutation)
- Deletes connection and cascades to mappings, synced entries, logs
- Returns: `{ success: true }`
- Errors: `NOT_FOUND` if no connection exists

### Security Implementation

**Token Encryption:**
- Algorithm: AES-256-GCM (authenticated encryption)
- Key: Shared with Google OAuth (`ENCRYPTION_KEY` env var)
- Storage: Separate fields for encrypted token, IV, and auth tag
- Prevents tampering via authentication tag

**Authorization:**
- All endpoints use `protectedProcedure` (requires authenticated session)
- Connection queries filter by `ctx.user.id`
- Unique constraint: 1 connection per user
- Cascade deletes ensure no orphaned data

**Error Handling:**
- Custom error classes: `RMAuthError`, `RMRateLimitError`, `RMValidationError`, `RMNotFoundError`, `RMNetworkError`
- Rate limit detection (HTTP 429)
- Generic error messages to prevent info disclosure
- Detailed error logging for debugging

### Frontend Features

**Settings Page (`/settings`):**

**Not Connected State:**
- Instructions to get RM API token
- Link to RM help documentation
- Token input field with show/hide toggle
- "Connect to RM" button (disabled if token empty)
- Loading state during connection

**Connected State:**
- Green success banner with checkmark
- Displays: RM user email, name, last sync date, connection date
- "Manage Project Mappings" button (links to Phase 2 page)
- "Disconnect" button with confirmation dialog
- Loading state during disconnect

**User Flow:**
1. User navigates to Settings from main nav
2. Clicks "Get Token from RM" link (opens RM in new tab)
3. Copies API token from RM Settings → Developer API
4. Pastes token and clicks "Connect to RM"
5. System validates token with RM API
6. Shows success message with user info
7. "Manage Project Mappings" button appears

### Testing Phase 1

**Prerequisites:**
- Running PostgreSQL database (Neon)
- `ENCRYPTION_KEY` environment variable set (32-byte hex)
- RM account with API access

**Manual Test Steps:**

1. **Start Development Server:**
   ```bash
   pnpm dev
   ```

2. **Navigate to Settings:**
   - Login to time-tracker
   - Click "Settings" in navigation
   - Should see RM Integration section

3. **Test Invalid Token:**
   - Enter random string as token
   - Click "Connect to RM"
   - Should see error: "Invalid RM API token - please check your token and try again"

4. **Test Valid Token:**
   - Get real RM API token from https://app.rm.smartsheet.com
   - Go to Settings → Developer API → copy token
   - Paste in time-tracker Settings
   - Click "Connect to RM"
   - Should see success with your RM email

5. **Verify Connection:**
   - Refresh page
   - Should still show "Connected to RM"
   - Verify email, connection date displayed

6. **Test Disconnect:**
   - Click "Disconnect"
   - Confirm dialog
   - Should return to "not connected" state
   - "Manage Project Mappings" button should disappear

7. **Verify Database:**
   ```bash
   pnpm db:studio
   ```
   - Open `RMConnection` table
   - Should see encrypted token, IV, authTag
   - Should see your RM user ID and email

**Expected Behavior:**
- ✅ Invalid tokens rejected with clear error
- ✅ Valid tokens accepted and stored encrypted
- ✅ Connection persists across page refreshes
- ✅ Disconnect removes all RM data
- ✅ No decrypted tokens visible in browser/logs

---

## Phase 2: Project Mapping 🚧 IN PROGRESS

**Status:** Not started
**Target:** Tasks 7-10

### Features to Implement

1. **RM Projects API**
   - Fetch all RM projects with pagination
   - Cache projects in frontend
   - Search/filter by name or code

2. **Project Mapping Service**
   - Fuzzy name matching (auto-suggestions)
   - Create/update/delete mappings
   - Validate 1:1 mapping constraint
   - List all mappings for user

3. **tRPC Endpoints**
   - `rm.projects.list` - Fetch RM projects
   - `rm.projects.mappings.list` - Get user's mappings
   - `rm.projects.mappings.create` - Map project
   - `rm.projects.mappings.suggestMatches` - Auto-suggest
   - `rm.projects.mappings.delete` - Unmap project

4. **Project Mapping Page**
   - Side-by-side view: time-tracker projects | RM projects
   - Search RM projects by name/code
   - Drag-and-drop or click-to-map interface
   - Show suggested matches with confidence score
   - "Auto-map all suggestions" button
   - Save/cancel changes

### Pending Files

```
apps/api/src/services/
└── rm-project-mapping.ts          [PENDING] Fuzzy matching service

apps/web/src/pages/
└── RMProjectMapping.tsx           [PENDING] Mapping UI page
```

---

## Phase 3: Manual Sync 📋 PLANNED

**Status:** Not started
**Target:** Tasks 11-17

### Features to Implement

1. **Time Entry Sync**
   - Push entries to RM (create/update)
   - Hash-based change detection
   - Skip zero-hour entries
   - Rate limit handling (exponential backoff)

2. **Sync Service**
   - Synchronous sync (no background jobs for MVP)
   - Filter to mapped projects only
   - Create/update `RMSyncedEntry` records
   - Log sync results to `RMSyncLog`

3. **Sync UI**
   - "Sync to RM" button in Timesheet Grid
   - Date range selector (default: current week)
   - Real-time progress modal
   - Entry-level status indicators (✓ synced, ⟳ pending, ✗ error)
   - Sync history dropdown

4. **Dry-Run Mode**
   - Preview sync without API calls
   - Show what would be created/updated
   - Validate all mappings exist

### Pending Files

```
apps/api/src/services/
├── rm-sync.ts                     [PENDING] Sync orchestration
└── rm-sync-helpers.ts             [PENDING] Hash calculation, filtering

apps/web/src/components/
├── RMSyncButton.tsx               [PENDING] Sync UI component
└── RMSyncProgressModal.tsx        [PENDING] Progress display
```

---

## Architecture Decisions

### One-Way Push (Not Bi-Directional)

**Rationale:**
- Simplest solution for MVP
- Avoids conflict resolution complexity
- time-tracker is source of truth
- Can add pull/bi-directional in v2

### Manual Sync (Not Auto-Sync)

**Rationale:**
- User control and visibility
- Errors visible immediately
- No hidden background failures
- Simpler architecture (no webhooks, polling)
- Can add auto-sync toggle later

### Explicit Project Mapping (Not Auto-Match Only)

**Rationale:**
- Prevents wrong categorization
- RM project IDs are critical
- Users confirm mappings
- Auto-suggest helps but doesn't decide

### Synchronous Sync (Not Background Jobs)

**Rationale:**
- Redis requires read-write access (blocked)
- Weekly syncs are small (~40 entries)
- Real-time progress more transparent
- Can add BullMQ jobs in Phase 4 if needed

### Hash-Based Change Detection

**Rationale:**
- Reliable across systems
- Works despite clock skew
- Detects actual content changes
- Simple SHA-256 hash of date+hours+notes

---

## Technical Notes

### RM API Details

**Base URL:** `https://api.rm.smartsheet.com/api/v1`
**Authentication:** `auth` header with API token
**Rate Limits:** Returns HTTP 429 when exceeded (no documented limits)
**Pagination:** Default 20/page, max 1000/page

**Key Endpoints Used:**
- `GET /users` - List users (used for token validation)
- `GET /projects?page=N&per_page=1000` - List projects
- `GET /time_entries?from=YYYY-MM-DD&to=YYYY-MM-DD` - List time entries
- `POST /users/:userId/time_entries` - Create time entry
- `PUT /users/:userId/time_entries/:id` - Update time entry
- `DELETE /users/:userId/time_entries/:id` - Delete time entry

**Time Entry Format:**
```json
{
  "user_id": 123,
  "assignable_id": 456,
  "date": "2024-01-15",
  "hours": 8.0,
  "task": "Development",
  "notes": "Feature implementation"
}
```

### Error Handling Strategy

1. **Rate Limits (429):**
   - Exponential backoff: 1s, 2s, 4s, 8s...
   - Max 5 retries
   - Show "syncing slowly" message to user

2. **Auth Errors (401, 403):**
   - Clear error message
   - Prompt to re-authenticate
   - Don't retry

3. **Validation Errors (400, 422):**
   - Parse RM error response
   - Show field-specific errors
   - Don't retry

4. **Network Errors:**
   - Retry up to 3 times
   - Log full error details
   - Show generic error to user

5. **Not Found (404):**
   - Detect deleted RM projects
   - Mark mapping as invalid
   - Skip entry, log error

### Performance Considerations

**Database Indexes:**
- `RMConnection.userId` (unique)
- `RMProjectMapping.connectionId`
- `RMProjectMapping.projectId`
- `RMSyncedEntry.timesheetEntryId` (unique)
- `RMSyncLog.connectionId`
- `RMSyncLog.status`

**Query Optimization:**
- Fetch only needed fields in tRPC endpoints
- Use `select` to limit returned data
- Cascade deletes via Prisma relations

**Frontend Caching:**
- React Query staleTime: 5 minutes for connection status
- Invalidate on mutation success
- Optimistic updates for better UX

---

## Environment Variables

**Required:**
```env
ENCRYPTION_KEY=<64-char-hex-string>  # Shared with Google OAuth
DATABASE_URL=<postgresql-connection-string>
```

**Not Required for RM:**
- No new environment variables needed
- RM tokens are user-provided
- Uses existing encryption key

---

## Future Enhancements (Out of MVP Scope)

### Phase 4: Background Jobs
- BullMQ integration for async sync
- Retry failed entries automatically
- Progress polling via job status
- Requires: Redis read-write access

### Phase 5: Bi-Directional Sync
- Pull RM entries → time-tracker
- Conflict resolution (last-write-wins or prompt)
- `source` field on TimesheetEntry: CALENDAR, MANUAL, RM_SYNC
- Requires: Webhook or polling strategy

### Phase 6: Advanced Features
- Auto-sync on entry save (optional toggle)
- Selective entry sync (checkboxes)
- Bulk operations (map all, sync all)
- Sync scheduling (daily, weekly)
- Export to CSV (RM-formatted)

### Phase 7: Reporting
- Sync analytics dashboard
- Success/failure rates over time
- Project-level sync status
- Entry-level audit trail

---

## Known Limitations (MVP)

1. **No Auto-Sync:**
   - User must manually click "Sync to RM"
   - Forgot to sync = entries missing in RM

2. **No Background Jobs:**
   - Sync blocks UI (but shows progress)
   - User must keep browser open
   - Large syncs (100+ entries) may be slow

3. **No Bi-Directional Sync:**
   - Can't edit in RM and pull back
   - time-tracker is always source of truth

4. **No Selective Sync:**
   - Syncs entire date range
   - Can't choose specific entries

5. **No Undo:**
   - Can't unsync an entry
   - Must delete in RM manually

6. **Rate Limit Handling:**
   - Exponential backoff may slow large syncs
   - No parallel requests (max 1 at a time)

---

## Testing Checklist

### Phase 1 (Complete)
- [x] Database migration applied successfully
- [x] Token encryption/decryption round-trip works
- [ ] Invalid token rejected with clear error
- [ ] Valid token accepted and stored
- [ ] Connection status persists across refreshes
- [ ] Disconnect removes all data
- [ ] No decrypted tokens in browser/logs
- [ ] Settings page accessible from nav
- [ ] UI states (connected/disconnected) render correctly

### Phase 2 (Pending)
- [ ] Fetch RM projects successfully
- [ ] Search/filter RM projects works
- [ ] Auto-suggest matches projects correctly
- [ ] Manual mapping creates database record
- [ ] Duplicate mapping prevented
- [ ] Unmap deletes mapping
- [ ] Mapping UI renders all projects

### Phase 3 (Pending)
- [ ] Dry-run shows accurate preview
- [ ] Sync creates RM time entries
- [ ] Changed entries update (not duplicate)
- [ ] Zero-hour entries skipped
- [ ] Rate limits handled gracefully
- [ ] Sync history displays correctly
- [ ] Entry status indicators accurate

---

## Troubleshooting

### Connection Issues

**Problem:** "Invalid RM API token" error
**Solution:**
- Verify token copied correctly (no extra spaces)
- Check token hasn't expired in RM
- Ensure RM account has API access enabled
- Try generating new token in RM

**Problem:** "Failed to connect to RM API: Network error"
**Solution:**
- Check internet connection
- Verify RM API is not down (check https://status.smartsheet.com)
- Check firewall/proxy settings

### Database Issues

**Problem:** Migration fails with "table already exists"
**Solution:**
```bash
cd packages/database
pnpm db:push --skip-generate
pnpm db:generate
```

**Problem:** Encrypted token not decrypting
**Solution:**
- Verify `ENCRYPTION_KEY` is 64 hex characters
- Check key hasn't changed since connection created
- If key rotated, users must reconnect

### Development Issues

**Problem:** TypeScript errors in RM files
**Solution:**
```bash
cd apps/api
pnpm install
npx prisma generate
```

**Problem:** Frontend can't find `rm` router
**Solution:**
- Verify backend is running
- Check `apps/api/src/routers/index.ts` imports `rmRouter`
- Clear browser cache and restart dev server

---

## References

- [RM API Documentation](https://help.smartsheet.com/articles/2482468-resource-management-api)
- [RM API Getting Started](https://app.rm.smartsheet.com/settings/api)
- [Prisma Docs](https://www.prisma.io/docs)
- [tRPC Docs](https://trpc.io/docs)
- [AES-GCM Encryption](https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options)

---

## Changelog

### 2025-01-13 - Phase 1 Complete
- ✅ Database schema created (4 models, 2 enums)
- ✅ Token encryption service implemented
- ✅ RM API client with error handling
- ✅ Connection service with CRUD operations
- ✅ tRPC router with 4 endpoints
- ✅ Settings page with connection UI
- ✅ Navigation integration
- ✅ Migration applied to Neon PostgreSQL
- 🚧 Ready for Phase 1 testing

### Next: Phase 2 - Project Mapping
- Fetch RM projects
- Fuzzy name matching
- Mapping CRUD endpoints
- Mapping UI page
