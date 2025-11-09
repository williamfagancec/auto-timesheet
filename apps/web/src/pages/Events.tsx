import { useState, useEffect, useCallback } from 'react'
import { trpc } from '../lib/trpc'
import { groupByDate, formatTime, formatDuration } from '../lib/dateUtils'
import { ProjectPicker } from '../components/ProjectPicker'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'

export function Events() {
  const queryClient = useQueryClient()

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  // No longer need categorization state - auto-save on selection

  const [showCalendarSetup, setShowCalendarSetup] = useState(false)
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])

  // Check calendar status
  const { data: calendarStatus } = trpc.calendar.status.useQuery()

  // List available calendars
  const { data: calendarsData, isLoading: calendarsLoading } = trpc.calendar.list.useQuery(
    undefined,
    { enabled: showCalendarSetup }
  )

  // Update calendar selection mutation
  const updateSelectionMutation = trpc.calendar.updateSelection.useMutation({
    onSuccess: () => {
      setShowCalendarSetup(false)
      handleSync()
    },
  })

  // Show setup if no calendars are selected
  useEffect(() => {
    if (calendarStatus && !calendarStatus.connected) {
      // No connection at all - redirect to connect
      return
    }
    if (calendarStatus && calendarStatus.selectedCalendarIds.length === 0) {
      setShowCalendarSetup(true)
    }
  }, [calendarStatus])

  // Query ALL calendar events with categorization status
  const {
    data: events = [],
    isLoading: eventsLoading,
    refetch: refetchEvents,
  } = trpc.calendar.getEventsWithStatus.useQuery({
    startDate: weekStart.toISOString(),
    endDate: weekEnd.toISOString(),
  })

  // No mapping needed - events already have correct shape from the API

  // Skip event mutation
  const skipEventMutation = trpc.timesheet.skipEvent.useMutation({
    onSuccess: () => {
      refetchEvents()
    },
  })

  // Single event categorization mutation (auto-save)
  const categorizeSingleMutation = trpc.timesheet.bulkCategorize.useMutation({
    onSuccess: () => {
      refetchEvents()
      // Invalidate timesheet grid cache so it auto-refreshes
      queryClient.invalidateQueries({ queryKey: [['timesheet', 'getWeeklyGrid']] })
    },
  })

  // Sync mutation
  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      console.log('Sync completed:', data)
      refetchEvents()
    },
    onError: (error) => {
      console.error('Sync failed:', error)
    },
  })

  const handleProjectSelect = (eventId: string, projectId: string) => {
    // Auto-save immediately when project is selected
    categorizeSingleMutation.mutate({
      entries: [{
        eventId,
        projectId,
      }]
    })
  }

  const handleSkip = (eventId: string) => {
    skipEventMutation.mutate({ eventId })
  }

  // Manual sync handler
  const handleSync = useCallback(() => {
    syncMutation.mutate()
  }, [syncMutation])

  // Week navigation handlers
  const handlePrevWeek = () => {
    setWeekStart((prev) => subWeeks(prev, 1))
  }

  const handleNextWeek = () => {
    setWeekStart((prev) => addWeeks(prev, 1))
  }

  const handleThisWeek = () => {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  // Group events by date
  const eventsWithDates = events.map((e: any) => ({
    ...e,
    startTime: new Date(e.startTime),
    endTime: new Date(e.endTime),
  }))

  const groupedEvents = groupByDate(eventsWithDates)
  const sortedDates = Array.from(groupedEvents.keys()).sort()

  // Count uncategorized
  const uncategorizedCount = events.filter((e: any) => !e.isCategorized && !e.isSkipped).length

  // Check if viewing current week
  const isThisWeek =
    format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  // Handle calendar selection save
  const handleSaveCalendarSelection = () => {
    if (selectedCalendarIds.length === 0) {
      alert('Please select at least one calendar')
      return
    }
    updateSelectionMutation.mutate({ calendarIds: selectedCalendarIds })
  }

  // Show calendar setup modal
  if (showCalendarSetup) {
    return (
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-4">Select Calendars to Sync</h2>
          <p className="text-gray-700 mb-4">
            Choose which Google calendars you want to sync with your timesheet
          </p>

          {calendarsLoading && <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />}

          {calendarsData && (
            <div className="space-y-2">
              {calendarsData.calendars.map((calendar: any) => (
                <label key={calendar.id} className="flex items-center space-x-3 p-3 border rounded hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCalendarIds.includes(calendar.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedCalendarIds([...selectedCalendarIds, calendar.id])
                      } else {
                        setSelectedCalendarIds(selectedCalendarIds.filter(id => id !== calendar.id))
                      }
                    }}
                    className="h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{calendar.summary}</div>
                    {calendar.description && (
                      <div className="text-sm text-gray-600">{calendar.description}</div>
                    )}
                  </div>
                  {calendar.primary && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Primary</span>
                  )}
                </label>
              ))}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleSaveCalendarSelection}
              disabled={selectedCalendarIds.length === 0 || updateSelectionMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {updateSelectionMutation.isPending ? 'Saving...' : 'Save & Sync'}
            </button>
          </div>

          {updateSelectionMutation.error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {updateSelectionMutation.error.message}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (eventsLoading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading events...</p>
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Events</h1>
            <p className="text-gray-600 mt-2">
              {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
              {isThisWeek && <span className="ml-2 text-sm text-blue-600 font-medium">(This week)</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Week Navigation */}
            <button
              onClick={handlePrevWeek}
              className="px-3 py-2 border rounded-md hover:bg-gray-50"
            >
              ← Prev
            </button>
            <button
              onClick={handleThisWeek}
              disabled={isThisWeek}
              className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              This Week
            </button>
            <button
              onClick={handleNextWeek}
              className="px-3 py-2 border rounded-md hover:bg-gray-50"
            >
              Next →
            </button>
            {/* Sync Button */}
            <button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2 ml-2"
            >
              {syncMutation.isPending ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                  Syncing...
                </>
              ) : (
                '🔄 Sync Calendar'
              )}
            </button>
          </div>
        </div>

        <div className="bg-white p-12 rounded-lg border text-center">
          <div className="text-6xl mb-4">📅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Events Found</h2>
          <p className="text-gray-600">
            No events found for this week. Try syncing your calendar or selecting a different week.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          <p className="text-gray-600 mt-2">
            {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
            {isThisWeek && <span className="ml-2 text-sm text-blue-600 font-medium">(This week)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Week Navigation */}
          <button
            onClick={handlePrevWeek}
            className="px-3 py-2 border rounded-md hover:bg-gray-50"
          >
            ← Prev
          </button>
          <button
            onClick={handleThisWeek}
            disabled={isThisWeek}
            className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            This Week
          </button>
          <button
            onClick={handleNextWeek}
            className="px-3 py-2 border rounded-md hover:bg-gray-50"
          >
            Next →
          </button>
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2 ml-2"
          >
            {syncMutation.isPending ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                Syncing...
              </>
            ) : (
              '🔄 Sync Calendar'
            )}
          </button>
        </div>
      </div>

      {/* Status Info */}
      {uncategorizedCount > 0 && (
        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800">
            <strong>{uncategorizedCount}</strong> event{uncategorizedCount !== 1 ? 's' : ''} need{uncategorizedCount === 1 ? 's' : ''} categorization
          </p>
        </div>
      )}

      {/* Events List */}
      <div className="space-y-6">
        {sortedDates.map((dateKey) => {
          const dayEvents = groupedEvents.get(dateKey)!
          const date = new Date(dateKey)
          const dayName = format(date, 'EEEE')
          const dateStr = format(date, 'MMMM d, yyyy')

          return (
            <div key={dateKey} className="bg-white rounded-lg border">
              {/* Day Header */}
              <div className="px-6 py-4 border-b bg-gray-50">
                <h3 className="text-lg font-semibold text-gray-900">{dayName}</h3>
                <p className="text-sm text-gray-600">{dateStr}</p>
              </div>

              {/* Events */}
              <div className="divide-y">
                {dayEvents.map((event: any) => {
                  const duration = Math.round(
                    (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) /
                      60000
                  )

                  const isCategorized = event.isCategorized
                  const isSkipped = event.isSkipped

                  return (
                    <div
                      key={event.id}
                      className={`px-6 py-4 transition-all ${
                        isCategorized ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                      } ${isSkipped ? 'bg-gray-100 opacity-60' : ''}`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Status Indicator */}
                        <div className="flex-shrink-0 w-6 pt-1">
                          {isCategorized && (
                            <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                              <svg
                                className="w-4 h-4 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                          {isSkipped && (
                            <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center">
                              <span className="text-white text-xs">⏭</span>
                            </div>
                          )}
                        </div>

                        {/* Time */}
                        <div className="flex-shrink-0 w-32">
                          <div className="text-sm font-medium text-gray-900">
                            {formatTime(new Date(event.startTime))} -{' '}
                            {formatTime(new Date(event.endTime))}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDuration(duration)}
                          </div>
                        </div>

                        {/* Event Details */}
                        <div className="flex-1">
                          <h4 className="text-base font-medium text-gray-900">{event.title}</h4>
                          {event.location && (
                            <p className="text-sm text-gray-500 mt-1">{event.location}</p>
                          )}
                          {isCategorized && event.projectName && (
                            <div className="mt-1">
                              <span className="inline-block px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                                {event.projectName}
                              </span>
                            </div>
                          )}
                          {isSkipped && (
                            <div className="mt-1">
                              <span className="inline-block px-2 py-1 text-xs font-medium bg-gray-200 text-gray-600 rounded">
                                Skipped
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Project Picker or Status */}
                        {!isSkipped && (
                          <div className="flex-shrink-0 w-64">
                            <ProjectPicker
                              value={event.projectId}
                              onSelect={(projectId) => handleProjectSelect(event.id, projectId)}
                              placeholder={isCategorized ? "Change project..." : "Select project..."}
                            />
                          </div>
                        )}

                        {/* Skip Button */}
                        {!isCategorized && !isSkipped && (
                          <button
                            onClick={() => handleSkip(event.id)}
                            disabled={skipEventMutation.isPending}
                            className="flex-shrink-0 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg border disabled:opacity-50"
                          >
                            Skip
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Auto-save status */}
      {categorizeSingleMutation.isPending && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-600">Saving...</p>
        </div>
      )}

      {/* Error Message */}
      {categorizeSingleMutation.isError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{categorizeSingleMutation.error.message}</p>
        </div>
      )}
    </div>
  )
}
