import { useState } from 'react'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { trpc } from '../lib/trpc'
import { ProjectPicker } from '../components/ProjectPicker'
import { groupByDate, formatDuration, formatTime } from '../lib/dateUtils'

interface CategorizationState {
  [eventId: string]: string | 'skip' | null
}

export function Timesheet() {
  // Default to current week
  const [weekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 })) // Monday
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 }) // Sunday

  // State for tracking project selections
  const [categorizations, setCategorizations] = useState<CategorizationState>({})

  // Fetch uncategorized events for the current week
  const { data: events = [], isLoading, refetch } = trpc.timesheet.getUncategorized.useQuery({
    startDate: weekStart.toISOString(),
    endDate: weekEnd.toISOString(),
  })

  // Skip event mutation
  const skipEventMutation = trpc.timesheet.skipEvent.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  // Bulk categorize mutation
  const bulkCategorizeMutation = trpc.timesheet.bulkCategorize.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setCategorizations({})
        refetch()
      }
    },
  })

  const handleProjectSelect = (eventId: string, projectId: string) => {
    setCategorizations((prev) => ({
      ...prev,
      [eventId]: projectId,
    }))
  }

  const handleSkip = (eventId: string) => {
    skipEventMutation.mutate({ eventId })
  }

  const handleSaveAll = () => {
    const entries = Object.entries(categorizations)
      .filter(([_, projectId]) => projectId && projectId !== 'skip')
      .map(([eventId, projectId]) => ({
        eventId,
        projectId: projectId as string,
      }))

    if (entries.length === 0) {
      alert('No events to categorize. Please select projects first.')
      return
    }

    bulkCategorizeMutation.mutate({ entries })
  }

  // Group events by date
  const groupedEvents = groupByDate(
    events.map((e: any) => ({
      ...e,
      startTime: new Date(e.startTime),
      endTime: new Date(e.endTime),
    }))
  )
  const sortedDates = Array.from(groupedEvents.keys()).sort()

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading timesheet...</p>
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Weekly Timesheet</h1>
          <p className="text-gray-600 mt-2">
            {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
          </p>
        </div>

        <div className="bg-white p-12 rounded-lg border text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">All Caught Up!</h2>
          <p className="text-gray-600">
            All your events for this week have been categorized.
          </p>
        </div>
      </div>
    )
  }

  const categorizedCount = Object.keys(categorizations).length
  const totalCount = events.length

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Weekly Timesheet</h1>
        <p className="text-gray-600 mt-2">
          {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
        </p>
      </div>

      {/* Progress Bar */}
      <div className="mb-8 bg-white p-6 rounded-lg border">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">Progress</span>
          <span className="text-sm text-gray-600">
            {categorizedCount} / {totalCount} categorized
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all"
            style={{ width: `${(categorizedCount / totalCount) * 100}%` }}
          />
        </div>
      </div>

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
                {dayEvents.map((event) => {
                  const duration = Math.round(
                    (new Date(event.endTime).getTime() - new Date(event.startTime).getTime()) /
                      60000
                  )

                  const isMapped = !!categorizations[event.id]

                  return (
                    <div
                      key={event.id}
                      className={`px-6 py-4 transition-all ${
                        isMapped ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        {/* Status Indicator */}
                        <div className="flex-shrink-0 w-6 pt-1">
                          {isMapped && (
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
                        </div>

                        {/* Project Picker */}
                        <div className="flex-shrink-0 w-64">
                          <ProjectPicker
                            value={categorizations[event.id] || undefined}
                            onSelect={(projectId) => handleProjectSelect(event.id, projectId)}
                            placeholder="Select project..."
                          />
                        </div>

                        {/* Skip Button */}
                        <button
                          onClick={() => handleSkip(event.id)}
                          disabled={skipEventMutation.isPending}
                          className="flex-shrink-0 px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg border disabled:opacity-50"
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Save Button */}
      <div className="mt-8 flex justify-between items-center bg-white p-6 rounded-lg border sticky bottom-8">
        <div className="text-sm text-gray-600">
          {categorizedCount > 0 ? (
            <span>
              {categorizedCount} event{categorizedCount !== 1 ? 's' : ''} ready to save
            </span>
          ) : (
            <span>Select projects to categorize your events</span>
          )}
        </div>

        <button
          onClick={handleSaveAll}
          disabled={categorizedCount === 0 || bulkCategorizeMutation.isPending}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {bulkCategorizeMutation.isPending ? 'Saving...' : `Save ${categorizedCount} Events`}
        </button>
      </div>

      {/* Error Message */}
      {bulkCategorizeMutation.isError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{bulkCategorizeMutation.error.message}</p>
        </div>
      )}

      {/* Success Message */}
      {bulkCategorizeMutation.isSuccess && bulkCategorizeMutation.data.success && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-600">
            Successfully categorized {bulkCategorizeMutation.data.created +
              bulkCategorizeMutation.data.updated}{' '}
            events!
          </p>
        </div>
      )}
    </div>
  )
}
