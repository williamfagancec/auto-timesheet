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

  const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch calendars: ${response.statusText}`)
  }

  const data = (await response.json()) as GoogleCalendarListResponse

  return data.items.map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    description: cal.description,
    primary: cal.primary,
    backgroundColor: cal.backgroundColor,
    foregroundColor: cal.foregroundColor,
    accessRole: cal.accessRole,
  }))
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

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`)
  }

  return response.json()
}
