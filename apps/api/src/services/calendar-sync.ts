import { prisma } from 'database'
import createDefaultSuggestionEngine from './suggestion-factory.js'
import { getValidAccessToken } from '../auth/token-refresh.js'
import { zonedTimeToUtc } from 'date-fns-tz'

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
 * Fetches events from timeMin to timeMax (typically start of week to end of today)
 */
export async function fetchPastEvents(
  userId: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date // End of current day - no default, caller must provide
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getValidAccessToken(userId, 'google')

  // Use the provided timeMax directly - caller is responsible for timezone handling
  const effectiveTimeMax = timeMax

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
 * Filter events based on response status and time
 * Exclude: declined, cancelled, future events (endTime > timeMax)
 * Include: confirmed, tentative, needsAction (if endTime <= timeMax)
 *
 * @param events - Array of Google Calendar events
 * @param timeMax - End of current day (events ending after this are excluded)
 */
export function filterEvents(
  events: GoogleCalendarEvent[],
  timeMax: Date
): GoogleCalendarEvent[] {
  return events.filter((event) => {
    // Skip cancelled events
    if (event.status === 'cancelled') {
      return false
    }

    // Get event end time
    const endTimeStr = event.end.dateTime || event.end.date
    if (!endTimeStr) return false

    const endTime = new Date(endTimeStr)

    // Include events that end on or before timeMax (end of today)
    // This includes: past events + all of today's events
    // TODO: Re-evaluate this comparison after getEndOfTodayInTimezone is fixed
    if (endTime >= timeMax) {
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
): Promise<{ created: number; updated: number; affectedEventIds: string[] }> {
  let created = 0
  let updated = 0
  const affectedEventIds: string[] = []

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
              attendees: event.attendees ? (structuredClone(event.attendees) as any) : undefined,
              location: event.location || null,
              status,
              isAllDay: false, // Multi-day splits are not all-day events
              splitIndex: segment.splitIndex,
            },
          })
          created++
          // created record has googleEventId + splitIndex — we don't have id here; record the googleEventId
          affectedEventIds.push(event.id)
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
              attendees: event.attendees ? (structuredClone(event.attendees) as any) : undefined,
              location: event.location || null,
              status,
              isAllDay,
            },
          })
          updated++
          affectedEventIds.push(existing.id)
        } else {
          await prisma.calendarEvent.create({
            data: {
              userId,
              googleEventId: event.id,
              calendarId,
              title: event.summary || 'Untitled',
              startTime,
              endTime,
              attendees: event.attendees ? (structuredClone(event.attendees) as any) : undefined,
              location: event.location || null,
              status,
              isAllDay,
              splitIndex: 0,
            },
          })
          created++
          affectedEventIds.push(event.id)
        }
      }
    } catch (error) {
      console.error(`Failed to save event ${event.id}:`, error)
    }
  }

  return { created, updated, affectedEventIds }
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
 * Get the current UTC time for calendar event filtering
 *
 * IMPORTANT: Calendar events are stored in UTC (Prisma DateTime field).
 * To determine which events have ended, we compare event.endTime (UTC) with current UTC time.
 *
 * The timezone parameter is for logging purposes only - to show the user's local time
 * alongside UTC time for debugging.
 *
 * Previous implementation incorrectly created a future UTC timestamp by treating
 * local time components as UTC (e.g., Sydney 9:36 AM became 9:36 AM UTC instead of current UTC).
 */
export function getUserLocalNow(timezone: string): Date {
  try {
    // Get current UTC time
    const now = new Date()

    // For debugging: show user's local time alongside UTC
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    const parts = formatter.formatToParts(now)
    const getValue = (type: string) => parts.find(p => p.type === type)?.value || '0'

    const localTimeStr = `${getValue('year')}-${getValue('month')}-${getValue('day')}T${getValue('hour')}:${getValue('minute')}:${getValue('second')}`

    console.log(`[Calendar Sync Timezone]`)
    console.log(`  Current UTC time:  ${now.toISOString()}`)
    console.log(`  User timezone:     ${timezone}`)
    console.log(`  User local time:   ${localTimeStr}`)

    // Return actual UTC time (not converted)
    return now
  } catch (error) {
    console.error(`Failed to format timezone ${timezone}, using UTC:`, error)
    return new Date()
  }
}

/**
 * Get end of current day in user's timezone (23:59:59.999)
 *
 * @returns Date object representing 23:59:59.999 of the current day in the user's timezone
 * @param timezone - IANA timezone string (for logging purposes)
 * @returns Date object representing now + 24 hours (guarantees today's events are included)
 */
export function getEndOfTodayInTimezone(timezone: string): Date {
  const now = new Date()
  try {
    // Get the user's local date (year, month, day) in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    const parts = formatter.formatToParts(now)
    const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
    const month = parts.find((p) => p.type === 'month')?.value ?? '01'
    const day = parts.find((p) => p.type === 'day')?.value ?? '01'

    // Build a local end-of-day string for the target timezone (no offset): YYYY-MM-DDT23:59:59.999
    const localEndOfDay = `${year}-${month}-${day}T23:59:59.999`

    // Convert that local end-of-day in the given timezone to an exact UTC Date using date-fns-tz.
    // zonedTimeToUtc handles DST and zone offsets at that specific local instant.
    const timeMax = zonedTimeToUtc(localEndOfDay, timezone)

    console.log(`[Timezone Calc] End of day for ${timezone}:`, {
      now: now.toISOString(),
      timeMax: timeMax.toISOString(),
      userLocalDate: `${year}-${month}-${day}`,
    })

    return timeMax
  } catch (error) {
    console.error(`Failed to calculate end of day for timezone ${timezone}:`, error)
    // Fallback: end of current UTC day
    const utcEndOfDay = new Date(now)
    utcEndOfDay.setHours(23, 59, 59, 999)
    return utcEndOfDay
  }
}

/**
 * Sync events for a user from all their selected calendars
 * Syncs events from start of current week through END OF TODAY (includes today's events)
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

  if (!connection?.selectedCalendarIds) {
    throw new Error('No calendar connection found or no calendars selected')
  }

  const selectedCalendarIds = connection.selectedCalendarIds as string[]
  const timeMin = getStartOfCurrentWeek()

  // Get end of current day in user's timezone (23:59:59.999)
  // This ensures we sync ALL events for today, not just those that have ended
  const userTimezone = connection.timezone || 'UTC'
  const timeMax = getEndOfTodayInTimezone(userTimezone)

  let totalCreated = 0
  let totalUpdated = 0
  let calendarsProcessed = 0

  console.log(`Syncing ${selectedCalendarIds.length} calendars for user ${userId}`)
  console.log(`User timezone: ${userTimezone}`)
  console.log(`Date range: ${timeMin.toISOString()} to ${timeMax.toISOString()} (through end of today)`)

  for (const calendarId of selectedCalendarIds) {
    try {
      console.log(`Fetching events from calendar ${calendarId}`)
      const events = await fetchPastEvents(userId, calendarId, timeMin, timeMax)

      // Log a few sample events for debugging
      if (events.length > 0) {
        console.log(`Sample events fetched (first 3):`)
        events.slice(0, 3).forEach(event => {
          const start = event.start.dateTime || event.start.date
          const end = event.end.dateTime || event.end.date
          console.log(`  - "${event.summary}" | ${start} to ${end} | status: ${event.status}`)
        })
      }

      const filteredEvents = filterEvents(events, timeMax)

      console.log(`Fetched ${events.length} events, ${filteredEvents.length} after filtering (timeMax: ${timeMax.toISOString()})`)

      // Log which events were filtered out
      const filteredOutCount = events.length - filteredEvents.length
      if (filteredOutCount > 0) {
        console.log(`${filteredOutCount} events filtered out - checking reasons...`)
        events.filter(e => !filteredEvents.includes(e)).slice(0, 3).forEach(event => {
          const endTime = new Date(event.end.dateTime || event.end.date!)
          const isCancelled = event.status === 'cancelled'
          const isDeclined = event.attendees?.find(a => a.self)?.responseStatus === 'declined'
          const isFuture = endTime > timeMax
          console.log(`  - Filtered: "${event.summary}" | cancelled:${isCancelled} declined:${isDeclined} future:${isFuture}`)
        })
      }

  const { created, updated, affectedEventIds } = await saveEventsToDatabase(userId, calendarId, filteredEvents)

  totalCreated += created
  totalUpdated += updated
      calendarsProcessed++

      console.log(`Calendar ${calendarId}: ${created} created, ${updated} updated`)

      // Generate suggestions for affected events (non-blocking but awaited here)
      try {
        if (affectedEventIds && affectedEventIds.length > 0) {
          const engine = createDefaultSuggestionEngine()
          const suggestionsMap = await engine.generateBatchSuggestions(affectedEventIds, userId)

          // Persist suggestion logs for non-null suggestions
          const logsToCreate = [] as { userId: string; eventId: string; suggestedProjectId: string; confidence: number; outcome: string }[]
          for (const [eventId, suggestion] of suggestionsMap.entries()) {
            if (suggestion) {
              logsToCreate.push({
                userId,
                eventId,
                suggestedProjectId: suggestion.projectId,
                confidence: suggestion.confidence,
                outcome: 'IGNORED',
              })
            }
          }

          if (logsToCreate.length > 0) {
            // Use createMany for bulk insert
            await prisma.suggestionLog.createMany({
              data: logsToCreate,
              skipDuplicates: true,
            })
          }
        }
      } catch (error) {
        console.error('[Calendar Sync] Suggestion generation failed:', error)
        // Do not fail sync on suggestion errors
      }
    } catch (error) {
      console.error(`Failed to sync calendar ${calendarId}:`, error)

      // Check if this is a token-related error that needs user intervention
      if (error instanceof Error) {
        const msg = (error.message ?? '').toUpperCase()
        // Comprehensive list of auth error keywords (case-insensitive via normalization)
        const authErrorKeywords = ['TOKEN', 'REFRESH', 'SESSION_INVALIDATED', 'CALENDAR_NOT_CONNECTED', 'ARCTIC_VALIDATION_ERROR', 'OAUTH_CONFIG_ERROR', 'NETWORK_ERROR']
        const isAuthError = authErrorKeywords.some(keyword => msg.includes(keyword))
        if (isAuthError) {
          // Re-throw token/auth errors so user can be notified
          throw error
        }
      }

      // Continue with other calendars for non-token errors
    }
  }

  return {
    calendarsProcessed,
    eventsCreated: totalCreated,
    eventsUpdated: totalUpdated,
  }
}
