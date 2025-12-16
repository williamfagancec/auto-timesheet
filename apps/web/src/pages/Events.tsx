import { useState, useEffect, useCallback } from 'react'
import { trpc } from '../lib/trpc'
import { groupByDate, formatTime, formatDuration } from '../lib/dateUtils'
import { ProjectPicker } from '../components/ProjectPicker'
import { ReconnectCalendarModal } from '../components/ReconnectCalendarModal'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'

export function Events() {
  const queryClient = useQueryClient()

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  // No longer need categorization state - auto-save on selection

  const [showCalendarSetup, setShowCalendarSetup] = useState(false)
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([])

  // Reconnect modal state
  const [showReconnectModal, setShowReconnectModal] = useState(false)
  const [reconnectErrorMessage, setReconnectErrorMessage] = useState<string>()

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

  // Fetch user defaults for billable (only when authenticated)
  const { data: userDefaults } = trpc.project.getDefaults.useQuery(undefined, {
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Single event categorization mutation (auto-save)
  const categorizeSingleMutation = trpc.timesheet.bulkCategorize.useMutation({
    onSuccess: () => {
      refetchEvents()
      // Invalidate timesheet grid cache so it auto-refreshes
      queryClient.invalidateQueries({ queryKey: [['timesheet', 'getWeeklyGrid']] })
    },
  })

  // State for billable per event
  const [eventBillable, setEventBillable] = useState<Record<string, boolean>>({})

  // Initialize state from existing events when they load
  useEffect(() => {
    if (events.length > 0) {
      const billableMap: Record<string, boolean> = {}

      events.forEach((event: any) => {
        if (event.isBillable !== undefined) {
          billableMap[event.id] = event.isBillable
        }
      })

      setEventBillable((prev) => ({ ...prev, ...billableMap }))
    }
  }, [events])

  // Sync mutation with token error handling
  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      console.log('Sync completed:', data)
      refetchEvents()
    },
    onError: (error) => {
      console.error('Sync failed:', error)

      // Check if this is a token-related error that needs reconnection
      const errorMsg = error.message
      const isTokenError =
        errorMsg.includes('TOKEN') ||
        errorMsg.includes('REFRESH') ||
        errorMsg.includes('SESSION_INVALIDATED') ||
        errorMsg.includes('CALENDAR_NOT_CONNECTED') ||
        errorMsg.includes('ARCTIC_VALIDATION_ERROR')

      if (isTokenError) {
        setReconnectErrorMessage(errorMsg)
        setShowReconnectModal(true)
      }
    },
  })

  const handleProjectSelect = (eventId: string, projectId: string) => {
    // Get billable for this event (use defaults if not set)
    const isBillable = eventBillable[eventId] ?? userDefaults?.isBillable ?? true

    // Auto-save immediately when project is selected
    categorizeSingleMutation.mutate({
      entries: [{
        eventId,
        projectId,
        isBillable,
      }]
    })

    // Note: Billable defaults are updated in the backend when entries are saved
  }

  const handleBillableChange = (eventId: string, isBillable: boolean) => {
    setEventBillable((prev) => ({ ...prev, [eventId]: isBillable }))
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
      <div className="space-y-lg">
        <div className="bg-white border border-border-light rounded-lg shadow-md overflow-hidden">
          <div className="bg-sandy px-xl py-lg border-b border-border-light">
            <h2 className="text-2xl font-semibold text-text-primary">Select Calendars to Sync</h2>
            <p className="text-text-secondary mt-xs">
              Choose which Google calendars you want to sync with your timesheet
            </p>
          </div>
          <div className="p-xl">

          {calendarsLoading && <div className="animate-spin h-8 w-8 border-4 border-accent-orange border-t-transparent rounded-full mx-auto" />}

          {calendarsData && (
            <div className="space-y-sm">
              {calendarsData.calendars.map((calendar: any) => (
                <label key={calendar.id} className="flex items-center gap-md p-md border border-border-light rounded-md hover:bg-bg-hover cursor-pointer transition-colors duration-150">
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
                    className="h-4 w-4 text-accent-orange"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-text-primary">{calendar.summary}</div>
                    {calendar.description && (
                      <div className="text-sm text-text-secondary">{calendar.description}</div>
                    )}
                  </div>
                  {calendar.primary && (
                    <span className="text-xs bg-bg-selected text-text-secondary px-sm py-xs rounded-sm">Primary</span>
                  )}
                </label>
              ))}
            </div>
          )}

          <div className="mt-xl flex gap-md">
            <button
              onClick={handleSaveCalendarSelection}
              disabled={selectedCalendarIds.length === 0 || updateSelectionMutation.isPending}
              className="btn-primary"
            >
              {updateSelectionMutation.isPending ? 'Saving...' : 'Save & Sync'}
            </button>
          </div>

          {updateSelectionMutation.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-md py-md rounded-md text-sm">
              {updateSelectionMutation.error.message}
            </div>
          )}
          </div>
        </div>
      </div>
    )
  }

  if (eventsLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="text-center py-12 animate-fade-in">
          <div className="spinner h-16 w-16 mx-auto"></div>
          <p className="mt-lg text-text-secondary font-medium">Loading events...</p>
          <div className="mt-md flex items-center justify-center gap-sm">
            <div className="w-2 h-2 bg-accent-orange rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-accent-purple rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <div className="w-2 h-2 bg-accent-blue rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        <div className="mb-xl flex justify-between items-center">
          <div className="animate-slide-in-left">
            <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Events</h1>
            <p className="text-text-secondary mt-xs text-sm flex items-center gap-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
              {isThisWeek && <span className="ml-sm badge badge-warning animate-pulse">This week</span>}
            </p>
          </div>
          <div className="flex items-center gap-sm animate-slide-in-right">
            {/* Week Navigation */}
            <button
              onClick={handlePrevWeek}
              className="btn-secondary"
            >
              ← Prev
            </button>
            <button
              onClick={handleThisWeek}
              disabled={isThisWeek}
              className="btn-secondary"
            >
              This Week
            </button>
            <button
              onClick={handleNextWeek}
              className="btn-secondary"
            >
              Next →
            </button>
            {/* Sync Button */}
            <button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="btn-accent ml-sm"
            >
              {syncMutation.isPending ? (
                <>
                  <div className="spinner w-4 h-4" />
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync Calendar
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-white p-2xl rounded-xl border border-border-light shadow-lg text-center animate-scale-in">
          <div className="text-7xl mb-lg animate-bounce-subtle">📅</div>
          <h2 className="text-2xl font-bold text-text-primary mb-sm">No Events Found</h2>
          <p className="text-text-secondary text-base max-w-md mx-auto">
            No events found for this week. Try syncing your calendar or selecting a different week.
          </p>
          <button
            onClick={handleSync}
            className="btn-accent mt-xl"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Sync Now
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-xl flex justify-between items-center">
        <div className="animate-slide-in-left">
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Events</h1>
          <p className="text-text-secondary mt-xs text-sm flex items-center gap-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
            {isThisWeek && <span className="ml-sm badge badge-warning animate-pulse">This week</span>}
          </p>
        </div>
        <div className="flex items-center gap-sm animate-slide-in-right">
          {/* Week Navigation */}
          <button
            onClick={handlePrevWeek}
            className="btn-secondary"
          >
            ← Prev
          </button>
          <button
            onClick={handleThisWeek}
            disabled={isThisWeek}
            className="btn-secondary"
          >
            This Week
          </button>
          <button
            onClick={handleNextWeek}
            className="btn-secondary"
          >
            Next →
          </button>
          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="btn-accent ml-sm"
          >
            {syncMutation.isPending ? (
              <>
                <div className="spinner w-4 h-4" />
                Syncing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync Calendar
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status Info */}
      {uncategorizedCount > 0 && (
        <div className="mb-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-lg shadow-md animate-scale-in">
          <div className="flex items-center gap-md">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-400 rounded-full flex items-center justify-center shadow-md animate-bounce-subtle">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-base text-amber-900 font-medium">
                <span className="text-xl font-bold text-accent-orange">{uncategorizedCount}</span> event{uncategorizedCount !== 1 ? 's' : ''} need{uncategorizedCount === 1 ? 's' : ''} categorization
              </p>
              <p className="text-sm text-amber-700">Assign projects to track your time accurately</p>
            </div>
            <div className="progress-bar w-24">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round((1 - uncategorizedCount / events.length) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Events List */}
      <div className="space-y-lg">
        {sortedDates.map((dateKey) => {
          const dayEvents = groupedEvents.get(dateKey)!
          const date = new Date(dateKey)
          const dayName = format(date, 'EEEE')
          const dateStr = format(date, 'MMMM d, yyyy')

          return (
            <div key={dateKey} className="bg-white rounded-xl border border-border-light shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 animate-fade-in-up" style={{ animationDelay: `${sortedDates.indexOf(dateKey) * 0.1}s` }}>
              {/* Day Header */}
              <div className="px-xl py-lg border-b border-border-light bg-gradient-to-r from-sandy-light to-sandy relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-mesh opacity-30" />
                <div className="relative">
                  <h3 className="text-xl font-bold text-text-primary flex items-center gap-sm">
                    <div className="w-2 h-2 bg-gradient-primary rounded-full animate-pulse" />
                    {dayName}
                  </h3>
                  <p className="text-sm text-text-secondary font-medium">{dateStr}</p>
                </div>
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
                      className={`px-xl py-lg transition-all duration-300 hover:bg-gradient-mesh ${
                        isCategorized ? 'border-l-4 border-l-green-500' : ''
                      } ${isSkipped ? 'bg-bg-hover opacity-60' : ''}`}
                    >
                      <div className="flex items-start gap-lg">
                        {/* Status Indicator */}
                        <div className="flex-shrink-0 w-8 pt-1">
                          {isCategorized && (
                            <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-md animate-success">
                              <svg
                                className="w-5 h-5 text-white"
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
                            <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center shadow-sm">
                              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                              </svg>
                            </div>
                          )}
                          {!isCategorized && !isSkipped && (
                            <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-400 rounded-full flex items-center justify-center shadow-md animate-pulse">
                              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Time */}
                        <div className="flex-shrink-0 w-32">
                          <div className="text-sm font-medium text-text-primary">
                            {formatTime(new Date(event.startTime))} -{' '}
                            {formatTime(new Date(event.endTime))}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {formatDuration(duration)}
                          </div>
                        </div>

                        {/* Event Details */}
                        <div className="flex-1">
                          <h4 className="text-base font-medium text-text-primary">{event.title}</h4>
                          {event.location && (
                            <p className="text-sm text-text-secondary mt-xs">{event.location}</p>
                          )}
                          {isCategorized && event.projectName && (
                            <div className="mt-xs">
                              <span className="badge badge-success shadow-sm">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                {event.projectName}
                              </span>
                            </div>
                          )}
                          {isSkipped && (
                            <div className="mt-xs">
                              <span className="badge bg-gray-100 text-gray-600">
                                Skipped
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Project Picker and Entry Details */}
                        {!isSkipped && (
                          <div className="flex-shrink-0 w-80 space-y-2">
                            <ProjectPicker
                              value={event.projectId}
                              onSelect={(projectId) => handleProjectSelect(event.id, projectId)}
                              placeholder={isCategorized ? "Change project..." : "Select project..."}
                            />
                            {isCategorized && (
                              <div className="flex items-center gap-md text-sm">
                                <label className="flex items-center gap-sm cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={eventBillable[event.id] ?? userDefaults?.isBillable ?? true}
                                    onChange={(e) => {
                                      handleBillableChange(event.id, e.target.checked)
                                      // Auto-save if project is already selected
                                      if (event.projectId) {
                                        categorizeSingleMutation.mutate({
                                          entries: [{
                                            eventId: event.id,
                                            projectId: event.projectId,
                                            isBillable: e.target.checked,
                                          }]
                                        })
                                      }
                                    }}
                                    className="w-4 h-4 text-accent-orange border-border-medium rounded focus:ring-accent-orange"
                                  />
                                  <span className="text-text-primary">Billable</span>
                                </label>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Skip Button */}
                        {!isCategorized && !isSkipped && (
                          <button
                            onClick={() => handleSkip(event.id)}
                            disabled={skipEventMutation.isPending}
                            className="btn-ghost text-sm flex-shrink-0"
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
        <div className="mt-lg p-lg bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl shadow-md animate-scale-in">
          <div className="flex items-center gap-md">
            <div className="spinner w-5 h-5" />
            <p className="text-base text-blue-700 font-medium">Saving changes...</p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {categorizeSingleMutation.isError && (
        <div className="mt-lg p-lg bg-gradient-to-r from-red-50 to-pink-50 border border-red-200 rounded-xl shadow-md animate-scale-in">
          <div className="flex items-center gap-md">
            <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-pink-400 rounded-full flex items-center justify-center shadow-md">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-base text-red-700 font-medium">Error saving changes</p>
              <p className="text-sm text-red-600">{categorizeSingleMutation.error.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Reconnect Calendar Modal */}
      <ReconnectCalendarModal
        isOpen={showReconnectModal}
        onClose={() => setShowReconnectModal(false)}
        errorMessage={reconnectErrorMessage}
      />
    </div>
  )
}
