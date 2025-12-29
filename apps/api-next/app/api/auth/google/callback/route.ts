import { NextRequest, NextResponse } from 'next/server'
import { getOAuthState } from '../../../../../auth/oauth-state-store'
import { google, validateGoogleConfig } from '../../../../../auth/google'
import { encrypt } from '../../../../../auth/encryption'
import { lucia } from '../../../../../auth/lucia'
import { prisma } from 'database'
// TODO: Re-enable after migrating services
// import { getUserTimezone } from '../../../../../services/google-calendar'
// import { syncUserEvents } from '../../../../../services/calendar-sync'

// Mark as dynamic route (don't prerender during build)
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Validate config at runtime
  validateGoogleConfig()
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

  console.log('[OAuth Callback] Received callback:', {
    code: code?.substring(0, 20) + '...',
    state: state?.substring(0, 20) + '...'
  })

  if (!code || !state) {
    console.error('[OAuth Callback] Missing code or state')
    return NextResponse.redirect(`${frontendUrl}/login?error=missing_oauth_params`)
  }

  try {
    // Get stored state from DATABASE (not memory - critical for serverless)
    const storedOAuth = await getOAuthState(state)

    if (!storedOAuth) {
      console.error('[OAuth Callback] OAuth state validation failed - state not found or expired')
      return NextResponse.redirect(`${frontendUrl}/login?error=invalid_oauth_state`)
    }

    console.log('[OAuth Callback] OAuth state validated successfully')

    // Exchange authorization code for tokens
    const tokens = await google.validateAuthorizationCode(code, storedOAuth.codeVerifier)

    // Fetch user info from Google
    const googleUserResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.accessToken()}`,
      },
    })

    if (!googleUserResponse.ok) {
      const errorText = await googleUserResponse.text()
      console.error('[OAuth Callback] Failed to fetch user info:', googleUserResponse.status, errorText)
      return NextResponse.redirect(`${frontendUrl}/login?error=oauth_failed`)
    }

    const googleUser: {
      id: string
      email: string
      name?: string
      picture?: string
    } = await googleUserResponse.json()

    if (!googleUser.email) {
      console.error('[OAuth Callback] No email in user info')
      return NextResponse.redirect(`${frontendUrl}/login?error=oauth_failed`)
    }

    console.log(`[OAuth Callback] User info retrieved: ${googleUser.email}`)

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: googleUser.email },
    })

    if (!user) {
      console.log(`[OAuth Callback] Creating new user: ${googleUser.email}`)
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name,
        },
      })
    } else {
      console.log(`[OAuth Callback] Existing user found: ${googleUser.email}`)
    }

    // Handle refresh token (may not be present on subsequent authorizations)
    let encryptedRefreshToken: string | null = null
    try {
      const refreshToken = tokens.refreshToken()
      if (refreshToken) {
        encryptedRefreshToken = encrypt(refreshToken)
        console.log('[OAuth Callback] Refresh token received and encrypted')
      }
    } catch (error) {
      console.log('[OAuth Callback] No refresh token (normal for subsequent authorizations)')
    }

    // Get user's timezone from Google Calendar
    // TODO: Re-enable after migrating google-calendar service
    const timezone = 'UTC' // Default for now
    console.log(`[OAuth Callback] Using default timezone: ${timezone}`)

    // Store calendar connection
    await prisma.calendarConnection.upsert({
      where: {
        userId_provider: {
          userId: user.id,
          provider: 'google',
        },
      },
      create: {
        userId: user.id,
        provider: 'google',
        accessToken: encrypt(tokens.accessToken()),
        refreshToken: encryptedRefreshToken,
        expiresAt: tokens.accessTokenExpiresAt(),
        timezone,
      },
      update: {
        accessToken: encrypt(tokens.accessToken()),
        ...(encryptedRefreshToken ? { refreshToken: encryptedRefreshToken } : {}),
        expiresAt: tokens.accessTokenExpiresAt(),
        timezone,
      },
    })

    console.log('[OAuth Callback] Calendar connection saved')

    // Create session
    const session = await lucia.createSession(user.id, {})
    const sessionCookie = lucia.createSessionCookie(session.id)

    const response = NextResponse.redirect(`${frontendUrl}/events`)
    response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes)

    console.log(`[OAuth Callback] Successfully authenticated user ${user.email}`)

    // TODO: Re-enable after migrating calendar-sync service
    // Trigger background calendar sync (fire-and-forget, 2-second delay)
    // setTimeout(() => {
    //   syncUserEvents(user.id)
    //     .then((result) => {
    //       console.log(`[OAuth Callback] Background calendar sync completed: ${result.eventsProcessed} events`)
    //     })
    //     .catch((error: any) => {
    //       console.error(`[OAuth Callback] Background calendar sync failed:`, error.message)
    //     })
    // }, 2000)

    return response
  } catch (error) {
    console.error('[OAuth Callback Error]', error)
    return NextResponse.redirect(`${frontendUrl}/login?error=oauth_failed`)
  }
}
