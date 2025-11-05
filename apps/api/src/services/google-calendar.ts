import { getValidAccessToken } from '../auth/token-refresh.js'

/**
 * Google Calendar API interfaces
 */
export interface GoogleCalendar {
  id: string
  summary: string
  description?: string
  primary?: boolean
  backgroundColor?: string
  foregroundColor?: string
  accessRole: string
}

export interface GoogleCalendarListResponse {
  items: GoogleCalendar[]
}

/**
 * Fetch list of calendars from Google Calendar API
 */
export async function listGoogleCalendars(userId: string): Promise<GoogleCalendar[]> {
  const accessToken = await getValidAccessToken(userId, 'google')

  try {
    const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10000), // 10 seconds timeout
    })

    if (!response.ok) {
      // Try to get detailed error from Google API
      let errorDetails = response.statusText
      try {
        const errorBody = await response.json()
        if (errorBody.error && errorBody.error.message) {
          errorDetails = errorBody.error.message
        }
      } catch {
        // If response body isn't JSON, use statusText
      }

      const errorMessage = `Failed to fetch calendars from Google (${response.status}): ${errorDetails}`
      console.error(errorMessage)

      // Provide specific guidance based on status code
      if (response.status === 401) {
        throw new Error('INVALID_TOKEN: Google Calendar access token is invalid or expired. Please re-authenticate.')
      } else if (response.status === 403) {
        throw new Error('INSUFFICIENT_PERMISSIONS: Missing required Google Calendar permissions. Please re-authenticate and grant calendar access.')
      } else if (response.status === 404) {
        throw new Error('CALENDAR_NOT_FOUND: The requested calendar does not exist.')
      } else if (response.status === 429) {
        throw new Error('RATE_LIMIT_EXCEEDED: Too many requests to Google Calendar API. Please try again later.')
      }

      throw new Error(errorMessage)
    }

    const data = (await response.json()) as GoogleCalendarListResponse

    if (!data.items) {
      console.warn('No calendars returned from Google Calendar API')
      return []
    }

    return data.items.map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      primary: cal.primary,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor,
      accessRole: cal.accessRole,
    }))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_TOKEN')) {
      // Re-throw token errors
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('REQUEST_TIMEOUT: Request to Google Calendar API timed out. Please check your internet connection.')
    }
    throw error
  }
}

/**
 * Fetch events from a specific calendar
 */
export async function fetchCalendarEvents(
  userId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
) {
  const accessToken = await getValidAccessToken(userId, 'google')

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(30000), // 30 seconds timeout
      }
    )

    if (!response.ok) {
      // Try to get detailed error from Google API
      let errorDetails = response.statusText
      try {
        const errorBody = await response.json()
        if (errorBody.error && errorBody.error.message) {
          errorDetails = errorBody.error.message
        }
      } catch {
        // If response body isn't JSON, use statusText
      }

      const errorMessage = `Failed to fetch events from calendar ${calendarId} (${response.status}): ${errorDetails}`
      console.error(errorMessage)

      // Provide specific guidance based on status code
      if (response.status === 401) {
        throw new Error('INVALID_TOKEN: Google Calendar access token is invalid or expired. Please re-authenticate.')
      } else if (response.status === 403) {
        throw new Error('INSUFFICIENT_PERMISSIONS: Missing required permissions to access this calendar.')
      } else if (response.status === 404) {
        throw new Error(`CALENDAR_NOT_FOUND: Calendar ${calendarId} not found or no longer accessible.`)
      } else if (response.status === 429) {
        throw new Error('RATE_LIMIT_EXCEEDED: Too many requests to Google Calendar API. Please try again later.')
      }

      throw new Error(errorMessage)
    }

    return response.json()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('REQUEST_TIMEOUT: Request to Google Calendar API timed out. Please check your internet connection.')
    }
    throw error
  }
}
