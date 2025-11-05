import { format } from 'date-fns'
import { groupByDate, calculateDurationMinutes, formatDuration, formatTime } from '../lib/dateUtils'

interface CalendarEvent {
  id: string
  title: string
  startTime: Date
  endTime: Date
  status: string
  isAllDay: boolean
  location?: string | null
  isDeleted: boolean
}

interface EventListProps {
  events: CalendarEvent[]
  onHideEvent: (eventId: string) => void
  detectOverlaps: (events: CalendarEvent[]) => Map<string, boolean>
}

export function EventList({ events, onHideEvent, detectOverlaps }: EventListProps) {
  const groupedEvents = groupByDate(events)
  const overlappingEvents = detectOverlaps(events)

  // Sort dates in ascending order
  const sortedDates = Array.from(groupedEvents.keys()).sort()

  if (events.length === 0) {
    return (
      <div className="bg-white p-8 rounded-lg border text-center">
        <p className="text-gray-500">No events found for this date range</p>
        <p className="text-sm text-gray-400 mt-2">
          Try syncing your calendar or selecting a different date range
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {sortedDates.map((dateKey) => {
        const dayEvents = groupedEvents.get(dateKey)!
        const totalMinutes = dayEvents.reduce((sum, event) => {
          if (event.isAllDay) {
            return sum + 450 // 7.5 hours for all-day events
          }
          return sum + calculateDurationMinutes(event.startTime, event.endTime)
        }, 0)

        const hasOverlaps = dayEvents.some((event) => overlappingEvents.get(event.id))

        const date = new Date(dateKey)
        const dayName = format(date, 'EEEE')
        const dateStr = format(date, 'MMMM d, yyyy')

        return (
          <div key={dateKey} className="bg-white rounded-lg border">
            {/* Day header */}
            <div className="px-6 py-4 border-b bg-gray-50">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{dayName}</h3>
                  <p className="text-sm text-gray-600">{dateStr}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900">
                    {formatDuration(totalMinutes)}
                  </div>
                  {hasOverlaps && (
                    <span className="text-xs text-orange-600 font-medium">
                      ⚠️ Needs Review (Overlaps)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Events list */}
            <div className="divide-y">
              {dayEvents.map((event) => {
                const duration = event.isAllDay
                  ? 450
                  : calculateDurationMinutes(event.startTime, event.endTime)
                const hasOverlap = overlappingEvents.get(event.id)
                const isTentative = event.status === 'tentative'

                return (
                  <div
                    key={event.id}
                    className={`px-6 py-4 hover:bg-gray-50 ${
                      isTentative ? 'border-l-4 border-dashed border-yellow-400' : ''
                    } ${hasOverlap ? 'bg-orange-50' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-gray-900">{event.title}</h4>
                          {isTentative && (
                            <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                              Tentative
                            </span>
                          )}
                          {hasOverlap && (
                            <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded">
                              Overlap
                            </span>
                          )}
                        </div>

                        <div className="mt-1 space-y-1 text-sm text-gray-600">
                          {event.isAllDay ? (
                            <p>All day (7.5 hours)</p>
                          ) : (
                            <p>
                              {formatTime(event.startTime)} - {formatTime(event.endTime)} (
                              {formatDuration(duration)})
                            </p>
                          )}
                          {event.location && <p>📍 {event.location}</p>}
                        </div>
                      </div>

                      <div className="ml-4 flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {formatDuration(duration)}
                        </span>
                        <button
                          onClick={() => onHideEvent(event.id)}
                          className="text-gray-400 hover:text-red-600 text-sm"
                          title="Exclude from timesheet"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
