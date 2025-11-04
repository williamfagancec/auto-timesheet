import { useState, useEffect, useCallback } from 'react'
import { trpc } from '../lib/trpc'
import { DateRangeSelector } from '../components/DateRangeSelector'
import { EventList } from '../components/EventList'
import { DateRange, getDateRangeForPreset } from '../lib/dateUtils'
import { detectOverlappingEvents } from '../lib/overlapDetection'

const AUTO_REFRESH_INTERVAL = 15 * 60 * 1000 // 15 minutes

export function Events() {
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const range = getDateRangeForPreset('this-week')
    return range || { startDate: new Date(), endDate: new Date() }
  })

  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)
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

  // Query events
  const {
    data: eventsData,
    isLoading: eventsLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = trpc.calendar.getEvents.useQuery({
    startDate: dateRange.startDate.toISOString(),
    endDate: dateRange.endDate.toISOString(),
  })

  // Sync mutation
  const syncMutation = trpc.calendar.sync.useMutation({
    onSuccess: (data) => {
      console.log('Sync completed:', data)
      setLastSyncTime(new Date())
      refetchEvents()
    },
    onError: (error) => {
      console.error('Sync failed:', error)
    },
  })

  // Hide event mutation
  const hideEventMutation = trpc.calendar.hideEvent.useMutation({
    onSuccess: () => {
      refetchEvents()
    },
  })

  // Manual sync handler
  const handleSync = useCallback(() => {
    syncMutation.mutate()
  }, [syncMutation])

  // Auto-refresh with Page Visibility API
  useEffect(() => {
    let intervalId: number | undefined

    const startAutoRefresh = () => {
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          console.log('Auto-refreshing events...')
          refetchEvents()
        }
      }, AUTO_REFRESH_INTERVAL)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab became visible, restarting auto-refresh')
        if (intervalId) {
          clearInterval(intervalId)
        }
        startAutoRefresh()
      } else {
        console.log('Tab hidden, pausing auto-refresh')
        if (intervalId) {
          clearInterval(intervalId)
        }
      }
    }

    // Start auto-refresh
    startAutoRefresh()

    // Listen for visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refetchEvents])

  // Handle hide event
  const handleHideEvent = (eventId: string) => {
    if (confirm('Are you sure you want to exclude this event from your timesheet?')) {
      hideEventMutation.mutate({ eventId })
    }
  }

  // Convert event dates from strings to Date objects
  const events = eventsData?.events.map((event) => ({
    ...event,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
  })) || []

  // Detect overlaps
  const overlappingEvents = detectOverlappingEvents(events)

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

  return (
    <div className="space-y-6">
      {/* Header with sync button */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          {lastSyncTime && (
            <p className="text-sm text-gray-600 mt-1">
              Last synced: {lastSyncTime.toLocaleTimeString()}
            </p>
          )}
        </div>

        <button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
        >
          {syncMutation.isPending ? (
            <>
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              Syncing...
            </>
          ) : (
            <>
              🔄 Sync Calendar
            </>
          )}
        </button>
      </div>

      {/* Sync error */}
      {syncMutation.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Failed to sync: {syncMutation.error.message}
        </div>
      )}

      {/* Date range selector */}
      <DateRangeSelector selectedRange={dateRange} onRangeChange={setDateRange} />

      {/* Events loading */}
      {eventsLoading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      )}

      {/* Events error */}
      {eventsError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Failed to load events: {eventsError.message}
        </div>
      )}

      {/* Events list */}
      {!eventsLoading && !eventsError && (
        <EventList
          events={events}
          onHideEvent={handleHideEvent}
          detectOverlaps={detectOverlappingEvents}
        />
      )}

      {/* Auto-refresh indicator */}
      <p className="text-xs text-gray-500 text-center">
        Events auto-refresh every 15 minutes while this tab is active
      </p>
    </div>
  )
}
