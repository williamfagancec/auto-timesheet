import { prisma } from 'database'
import { getValidAccessToken } from '../auth/token-refresh.js'

/**
 * Google Calendar API event interfaces
 */
interface GoogleCalendarEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  start: {
    dateTime?: string
    date?: string // for all-day events
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: Array<{
    email: string
    responseStatus: 'needsAction' | 'declined' | 'tentative' | 'accepted'
    self?: boolean // Indicates if this attendee is the signed-in user
  }>
  status?: string // confirmed, tentative, cancelled
  creator?: {
    email: string
  }
}

interface GoogleCalendarEventsResponse {
  items: GoogleCalendarEvent[]
  nextPageToken?: string
}

/**
 * Fetch events from a specific Google Calendar within a date range
 * Only fetches PAST events (endTime < now)
 */
export async function fetchPastEvents(
  userId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date = new Date() // Default to now
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidAccessToken(userId, 'google')
  const now = new Date()

  // Ensure we don't fetch future events
  const effectiveTimeMax = timeMax > now ? now : timeMax

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: effectiveTimeMax.toISOString(),
    singleEvents: 'true', // Expand recurring events
    orderBy: 'startTime',
    maxResults: '2500', // Google's max per request
  })

  const allEvents: GoogleCalendarEvent[] = []
  let pageToken: string | undefined

  do {
    if (pageToken) {
      params.set('pageToken', pageToken)
    }

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
      throw new Error(`Failed to fetch events from calendar ${calendarId}: ${response.statusText}`)
    }

    const data = (await response.json()) as GoogleCalendarEventsResponse
    allEvents.push(...(data.items || []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return allEvents
}

/**
 * Filter events based on response status
 * Exclude: declined, cancelled
 * Include: confirmed, tentative, needsAction
 */
export function filterEvents(events: GoogleCalendarEvent[]): GoogleCalendarEvent[] {
  const now = new Date()

  return events.filter((event) => {
    // Skip cancelled events
    if (event.status === 'cancelled') {
      return false
    }

    // Get event end time
    const endTimeStr = event.end.dateTime || event.end.date
    if (!endTimeStr) return false

    const endTime = new Date(endTimeStr)

    // Only include past events (ended before now)
    if (endTime >= now) {
      return false
    }

    // Check if the signed-in user themselves declined the event
    if (event.attendees) {
      const selfAttendee = event.attendees.find((attendee) => attendee.self === true)
      if (selfAttendee && selfAttendee.responseStatus === 'declined') {
        return false
      }
    }

    return true
  })
}

/**
 * Check if an event spans multiple days (crosses midnight)
 */
function isMultiDayEvent(startTime: Date, endTime: Date): boolean {
  const startDate = new Date(startTime)
  startDate.setHours(0, 0, 0, 0)

  const endDate = new Date(endTime)
  endDate.setHours(0, 0, 0, 0)

  return startDate.getTime() !== endDate.getTime()
}

/**
 * Split a multi-day event into separate day segments
 * Returns array of { splitIndex, startTime, endTime }
 */
function splitMultiDayEvent(startTime: Date, endTime: Date): Array<{
  splitIndex: number
  startTime: Date
  endTime: Date
}> {
  const segments = []
  let currentStart = new Date(startTime)
  let splitIndex = 1

  while (currentStart < endTime) {
    // Find end of current day (midnight)
    const endOfDay = new Date(currentStart)
    endOfDay.setHours(23, 59, 59, 999)

    // Determine segment end time (either end of day or event end)
    const segmentEnd = endOfDay < endTime ? endOfDay : endTime

    segments.push({
      splitIndex,
      startTime: new Date(currentStart),
      endTime: new Date(segmentEnd),
    })

    // Move to start of next day
    currentStart = new Date(endOfDay)
    currentStart.setMilliseconds(currentStart.getMilliseconds() + 1)
    currentStart.setHours(0, 0, 0, 0)
    splitIndex++
  }

  return segments
}

/**
 * Save events to database (upsert to handle updates)
 * Handles multi-day event splitting
 */
export async function saveEventsToDatabase(
  userId: string,
  calendarId: string,
  events: GoogleCalendarEvent[]
): Promise<{ created: number; updated: number }> {
  let created = 0
  let updated = 0

  for (const event of events) {
    const startTimeStr = event.start.dateTime || event.start.date
    const endTimeStr = event.end.dateTime || event.end.date

    if (!startTimeStr || !endTimeStr) {
      console.warn(`Skipping event ${event.id} - missing start/end time`)
      continue
    }

    const startTime = new Date(startTimeStr)
    const endTime = new Date(endTimeStr)
    const isAllDay = !event.start.dateTime // All-day events use 'date' not 'dateTime'

    // Determine status (use tentative if user marked as tentative)
    let status = event.status || 'confirmed'
    if (event.attendees) {
      const userTentative = event.attendees.some(
        (attendee) => attendee.responseStatus === 'tentative'
      )
      if (userTentative) {
        status = 'tentative'
      }
    }

    try {
      // Check if event spans multiple days AND is a timed event (not all-day)
      // All-day events should remain as single records with isAllDay=true
      if (isMultiDayEvent(startTime, endTime) && !isAllDay) {
        console.log(`Splitting multi-day timed event ${event.id}`)
        const segments = splitMultiDayEvent(startTime, endTime)

        // First, delete any existing segments that are no longer valid
        await prisma.calendarEvent.deleteMany({
          where: {
            userId,
            googleEventId: event.id,
          },
        })

        // Create new segments
        for (const segment of segments) {
          await prisma.calendarEvent.create({
            data: {
              userId,
              googleEventId: event.id,
              calendarId,
              title: event.summary || 'Untitled',
              startTime: segment.startTime,
              endTime: segment.endTime,
              attendees: event.attendees ? JSON.parse(JSON.stringify(event.attendees)) : null,
              location: event.location || null,
              status,
              isAllDay: false, // Multi-day splits are not all-day events
              splitIndex: segment.splitIndex,
            },
          })
          created++
        }
      } else {
        // Single-day event - normal upsert
        const existing = await prisma.calendarEvent.findFirst({
          where: {
            userId,
            googleEventId: event.id,
            splitIndex: 0,
          },
        })

        if (existing) {
          await prisma.calendarEvent.update({
            where: { id: existing.id },
            data: {
              calendarId,
              title: event.summary || 'Untitled',
              startTime,
              endTime,
              attendees: event.attendees ? JSON.parse(JSON.stringify(event.attendees)) : null,
              location: event.location || null,
              status,
              isAllDay,
            },
          })
          updated++
        } else {
          await prisma.calendarEvent.create({
            data: {
              userId,
              googleEventId: event.id,
              calendarId,
              title: event.summary || 'Untitled',
              startTime,
              endTime,
              attendees: event.attendees ? JSON.parse(JSON.stringify(event.attendees)) : null,
              location: event.location || null,
              status,
              isAllDay,
              splitIndex: 0,
            },
          })
          created++
        }
      }
    } catch (error) {
      console.error(`Failed to save event ${event.id}:`, error)
    }
  }

  return { created, updated }
}

/**
 * Get start of current week (Monday 00:00:00)
 */
export function getStartOfCurrentWeek(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day // Adjust when day is Sunday (0)
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

/**
 * Get the current time in user's local timezone
 * This is used to determine which events have already ended
 */
export function getUserLocalNow(timezone: string): Date {
  try {
    // Get current UTC time
    const now = new Date()

    // Convert to user's timezone using Intl.DateTimeFormat
    // This gives us the local time components
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })

    const parts = formatter.formatToParts(now)
    const getValue = (type: string) => parts.find(p => p.type === type)?.value || '0'

    // Create a date string in ISO format for the user's local time
    const year = getValue('year')
    const month = getValue('month')
    const day = getValue('day')
    const hour = getValue('hour')
    const minute = getValue('minute')
    const second = getValue('second')

    // Create a new Date object representing the local time as if it were UTC
    // This gives us a UTC timestamp that represents the user's current local time
    const localTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)

    console.log(`Current UTC time: ${now.toISOString()}`)
    console.log(`User's local time (${timezone}): ${localTime.toISOString()}`)

    return localTime
  } catch (error) {
    console.error(`Failed to convert timezone ${timezone}, falling back to UTC:`, error)
    return new Date()
  }
}

/**
 * Sync events for a user from all their selected calendars
 * Only syncs PAST events from start of current week to now
 */
export async function syncUserEvents(userId: string): Promise<{
  calendarsProcessed: number
  eventsCreated: number
  eventsUpdated: number
}> {
  // Get user's calendar connection
  const connection = await prisma.calendarConnection.findUnique({
    where: {
      userId_provider: { userId, provider: 'google' },
    },
  })

  if (!connection || !connection.selectedCalendarIds) {
    throw new Error('No calendar connection found or no calendars selected')
  }

  const selectedCalendarIds = connection.selectedCalendarIds as string[]
  const timeMin = getStartOfCurrentWeek()

  // Get "now" in user's timezone
  const userTimezone = connection.timezone || 'UTC'
  const timeMax = getUserLocalNow(userTimezone)

  let totalCreated = 0
  let totalUpdated = 0
  let calendarsProcessed = 0

  console.log(`Syncing ${selectedCalendarIds.length} calendars for user ${userId}`)
  console.log(`User timezone: ${userTimezone}`)
  console.log(`Date range: ${timeMin.toISOString()} to ${timeMax.toISOString()}`)

  for (const calendarId of selectedCalendarIds) {
    try {
      console.log(`Fetching events from calendar ${calendarId}`)
      const events = await fetchPastEvents(userId, calendarId, timeMin, timeMax)
      const filteredEvents = filterEvents(events)

      console.log(`Fetched ${events.length} events, ${filteredEvents.length} after filtering`)

      const { created, updated } = await saveEventsToDatabase(userId, calendarId, filteredEvents)

      totalCreated += created
      totalUpdated += updated
      calendarsProcessed++

      console.log(`Calendar ${calendarId}: ${created} created, ${updated} updated`)
    } catch (error) {
      console.error(`Failed to sync calendar ${calendarId}:`, error)
      // Continue with other calendars even if one fails
    }
  }

  return {
    calendarsProcessed,
    eventsCreated: totalCreated,
    eventsUpdated: totalUpdated,
  }
}
