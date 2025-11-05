# OAuth Token Issues Analysis

## Potential Issues Identified

### 1. **Poor Error Handling in OAuth Callback**
**Location**: `apps/api/src/routers/auth.ts:300-306`

**Issue**: The catch block swallows all errors and returns a generic message.

```typescript
} catch (error) {
  console.error('Google OAuth error:', error)
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to complete Google authentication',
  })
}
```

**Impact**: If token encryption fails, token validation fails, or Google API returns a specific error, the user/developer gets no useful information.

**Fix**: Add detailed error logging and return more specific error messages.

### 2. **Token Refresh Error Handling**
**Location**: `apps/api/src/auth/token-refresh.ts:29-32`

**Issue**: Generic error message when token refresh fails.

```typescript
catch (error) {
  console.error('Failed to refresh Google token:', error)
  throw new Error('Failed to refresh access token')
}
```

**Impact**: Doesn't distinguish between:
- Invalid/revoked refresh token (user needs to re-authenticate)
- Network errors (transient, should retry)
- Invalid OAuth credentials (configuration issue)

**Fix**: Parse the error and provide specific guidance.

### 3. **Potential Token Expiry Edge Case**
**Location**: `apps/api/src/auth/token-refresh.ts:58`

**Issue**: Tokens are checked with a 5-minute buffer, but if a request takes longer than 5 minutes or if there's a race condition with multiple requests, a token might expire mid-request.

**Fix**: Add retry logic or extend the buffer time.

### 4. **No Token Validation After Refresh**
**Location**: `apps/api/src/auth/token-refresh.ts:66-80`

**Issue**: After refreshing a token, the code doesn't verify the new token works before saving it to the database.

**Fix**: Add a validation step to test the new token.

### 5. **Missing Error Context in Calendar API Calls**
**Location**: `apps/api/src/services/google-calendar.ts:33-34`, `79-80`

**Issue**: When Google Calendar API calls fail, only the status text is returned, not the actual error message from Google.

```typescript
if (!response.ok) {
  throw new Error(\`Failed to fetch calendars: \${response.statusText}\`)
}
```

**Impact**: Can't distinguish between:
- 401 Unauthorized (token issue)
- 403 Forbidden (permissions issue)
- 404 Not Found (calendar doesn't exist)
- 429 Rate Limited

**Fix**: Parse the response body for detailed error messages.

### 6. **Race Condition in Token Refresh**
**Location**: `apps/api/src/auth/token-refresh.ts:115-133`

**Issue**: If multiple requests come in simultaneously for the same user, they might all try to refresh the token at once, causing conflicts or rate limiting.

**Fix**: Implement a mutex/lock mechanism.

### 7. **No Retry Logic for Transient Failures**
**Issue**: Network timeouts or temporary Google API issues will cause immediate failure.

**Fix**: Add retry logic with exponential backoff for 5xx errors and network timeouts.

## Recommended Fixes Priority

### High Priority
1. ✅ Improve error handling in OAuth callback with detailed error types
2. ⚠️ Add better error messages in token refresh with actionable guidance (refresh token rotation missing)
3. ✅ Parse Google API error responses properly

### Medium Priority
4. ⚠️ Add token validation after refresh (no validation after refresh)
5. ⚠️ Implement mutex for token refresh (prevents race conditions)
6. ⚠️ Add retry logic for transient failures

### Low Priority
7. Monitor token expiry edge cases
8. Add metrics/logging for OAuth flow debugging

## Testing Recommendations

1. **Test expired token scenario**: Manually set a token expiry to past date and verify refresh works
2. **Test revoked token scenario**: Revoke access in Google account settings and verify error message
3. **Test invalid credentials**: Use wrong CLIENT_ID/SECRET and verify error message
4. **Test network failures**: Use network throttling to verify timeout handling
5. **Test concurrent requests**: Send multiple calendar API requests simultaneously to check for race conditions
