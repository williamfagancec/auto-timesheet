# API Key Authentication

## Overview

The time-tracker API supports two authentication methods:
1. **Session-based** (cookies) - for frontend web app
2. **API key-based** (headers) - for automated scripts and integrations

This guide covers API key authentication for programmatic access.

## Setup

### 1. Generate a Secure API Key

Generate a cryptographically secure API key using OpenSSL:

```bash
openssl rand -hex 32
```

This will output a 64-character hexadecimal string like:
```
fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4
```

### 2. Add to Environment Variables

Add the generated key to your `.env` file:

```env
TEAM_API_KEY="fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4"
```

### 3. Restart API Server

Restart the API server to load the new environment variable:

```bash
pnpm dev:api
```

## Making Requests

### Required Headers

Include two headers in every API request:

```
Authorization: Bearer <TEAM_API_KEY>
X-User-ID: <USER_ID>
```

- **Authorization**: Contains your team API key with "Bearer " prefix
- **X-User-ID**: The ID of the user whose data you want to access

### Get User ID

To find a user's ID, you can:
1. Query the database: `SELECT id FROM "User" WHERE email = 'user@example.com'`
2. Check the frontend URL after login (often includes user ID in state)
3. Use the auth status endpoint with session-based auth to get your own user ID

## Usage Examples

### Example 1: Fetch Projects

```bash
curl http://localhost:3001/trpc/project.list \
  -H "Authorization: Bearer fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4" \
  -H "X-User-ID: cm123xyz789" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "result": {
    "data": [
      {
        "id": "proj_abc123",
        "name": "Client Project A",
        "color": "#3b82f6",
        "isArchived": false,
        "createdAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### Example 2: Create Manual Timesheet Entry

```bash
curl -X POST http://localhost:3001/trpc/timesheet.createManualEntry \
  -H "Authorization: Bearer fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4" \
  -H "X-User-ID: cm123xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-12-18T00:00:00.000Z",
    "projectId": "proj_abc123",
    "duration": 480,
    "notes": "API created entry",
    "isBillable": true,
    "phase": "Development"
  }'
```

**Response:**
```json
{
  "result": {
    "data": {
      "id": "entry_xyz789",
      "date": "2025-12-18T00:00:00.000Z",
      "projectId": "proj_abc123",
      "duration": 480,
      "notes": "API created entry",
      "isBillable": true,
      "phase": "Development"
    }
  }
}
```

### Example 3: Get Weekly Timesheet Grid

```bash
curl "http://localhost:3001/trpc/timesheet.getWeeklyGrid?input=%7B%22weekStartDate%22%3A%222025-12-16%22%7D" \
  -H "Authorization: Bearer fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4" \
  -H "X-User-ID: cm123xyz789"
```

Note: Query parameters must be URL-encoded. The `input` parameter contains:
```json
{"weekStartDate": "2025-12-16"}
```

### Example 4: Sync to RM

```bash
curl -X POST http://localhost:3001/trpc/rm.sync.execute \
  -H "Authorization: Bearer fd240b33967b895de89d0b30362b67d12207cf5ecf09475dccf35a320ef144e4" \
  -H "X-User-ID: cm123xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2025-12-16",
    "endDate": "2025-12-22"
  }'
```

## Security

### Best Practices

1. **Never commit API keys to version control**
   - Add `.env` to `.gitignore`
   - Use environment variables for all secrets
   - Rotate keys if accidentally exposed

2. **Use HTTPS only in production**
   - HTTP requests with API keys are rejected in production
   - Always use `https://` URLs for production endpoints
   - Development allows HTTP for testing (localhost only)

3. **Rotate keys periodically**
   - Generate new key quarterly
   - Update `.env` with new key
   - Restart API server
   - Update all scripts/integrations

4. **Limit key scope**
   - API key is team-wide (all users)
   - Always provide valid X-User-ID header
   - Server validates user exists before granting access

5. **Monitor usage**
   - Check server logs for suspicious activity
   - Look for failed authentication attempts
   - Track unusual access patterns

### Key Rotation Procedure

1. Generate a new API key:
   ```bash
   openssl rand -hex 32
   ```

2. Update `.env` with new `TEAM_API_KEY`:
   ```env
   TEAM_API_KEY="<new-key-here>"
   ```

3. Restart API server:
   ```bash
   pnpm dev:api  # Development
   # or restart production server
   ```

4. Update all scripts and integrations with new key

5. Verify old key no longer works (should return 401 UNAUTHORIZED)

### Rate Limiting

API key requests are subject to the same rate limits as session-based requests:

- **200 requests per minute per IP address**
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Timestamp when limit resets

## Troubleshooting

### Error: "UNAUTHORIZED"

**Possible causes:**
- Invalid API key (check `.env` file)
- Missing `Authorization` header
- Missing `X-User-ID` header
- Invalid user ID (user doesn't exist)

**Solution:**
- Verify `TEAM_API_KEY` matches value in `.env`
- Ensure both headers are present
- Check user ID is correct (query database to verify)

### Error: "API key authentication requires HTTPS"

**Cause:**
- Making HTTP request in production environment

**Solution:**
- Use `https://` URL instead of `http://`
- This error only occurs in production (not development)

### Error: "Not allowed by CORS"

**Cause:**
- Browser making request from disallowed origin
- This typically doesn't affect curl/server-to-server requests

**Solution:**
- API key auth is designed for server-to-server communication
- For browser-based access, use session-based authentication
- If needed, add origin to CORS allowlist in `apps/api/src/index.ts`

### Error: "Too Many Requests" (429)

**Cause:**
- Exceeded rate limit (200 requests/minute)

**Solution:**
- Implement exponential backoff in your client
- Reduce request frequency
- Check `X-RateLimit-Reset` header to know when limit resets

### Authorization Header Not Working

**Check:**
1. Header format: `Authorization: Bearer <key>` (case-sensitive "Bearer")
2. No extra spaces or line breaks in key
3. Key matches exactly what's in `.env` (64 hex characters)
4. Server restarted after updating `.env`

## Implementation Details

### Authentication Flow

```
1. Client sends request with:
   - Authorization: Bearer <API_KEY>
   - X-User-ID: <USER_ID>

2. Server extracts headers in createContext()

3. Server validates API key (constant-time comparison)

4. Server fetches user from database by ID

5. If valid:
   - Sets ctx.user
   - Sets ctx.authMethod = 'api_key'
   - Proceeds to endpoint

6. If invalid:
   - Returns 401 UNAUTHORIZED
```

### Security Features

- **Constant-time comparison**: Prevents timing attacks on API key
- **Log sanitization**: Authorization header never appears in logs
- **HTTPS enforcement**: Production requires secure transport
- **User validation**: Ensures user exists before granting access
- **Rate limiting**: Per-IP limits prevent abuse

### Dual Authentication

The API supports both authentication methods simultaneously:

- **Web app**: Uses session cookies (automatic, browser-based)
- **Scripts**: Use API keys (manual, programmatic)
- **All endpoints**: Accept either authentication method
- **No conflicts**: Sessions and API keys work independently

## Available Endpoints

All tRPC endpoints that use `protectedProcedure` are accessible via API key authentication:

### Authentication
- `auth.status` - Get current auth status

### Projects
- `project.list` - List all projects
- `project.create` - Create new project
- `project.update` - Update project
- `project.archive` - Archive project
- `project.getDefaults` - Get user project defaults
- `project.updateDefaults` - Update user defaults

### Calendar
- `calendar.listCalendars` - List Google calendars
- `calendar.selectCalendars` - Select calendars to sync
- `calendar.syncNow` - Trigger manual sync
- `calendar.getEventsWithStatus` - Get events with categorization status

### Timesheet
- `timesheet.getWeeklyGrid` - Get weekly timesheet data
- `timesheet.createManualEntry` - Create manual time entry
- `timesheet.updateCell` - Update timesheet cell
- `timesheet.bulkCategorize` - Categorize multiple events
- `timesheet.assignEventToProject` - Assign event to project
- `timesheet.resetToEvents` - Reset to event-sourced hours

### RM Integration
- `rm.testConnection` - Test RM API connection
- `rm.saveConnection` - Save RM connection
- `rm.getConnection` - Get RM connection status
- `rm.sync.preview` - Preview sync to RM
- `rm.sync.execute` - Execute sync to RM
- `rm.sync.history` - Get sync history

### Suggestions (AI)
- `suggestions.getSuggestions` - Get AI categorization suggestions
- `suggestions.feedback` - Provide feedback on suggestions

### Analytics
- `analytics.metrics` - Get analytics metrics
- `analytics.problematicPatterns` - Get problematic patterns

## Support

For issues or questions:
- Check server logs for detailed error messages
- Verify environment variables are set correctly
- Ensure API server is running and accessible
- Test with curl before integrating into scripts
