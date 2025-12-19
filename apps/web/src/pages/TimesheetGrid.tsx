import { useState, useEffect, useRef, useCallback } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns'
import { trpc } from '../lib/trpc'
import { RMSyncButton } from '../components/RMSyncButton'

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

const DAY_NAMES: { key: DayKey; short: string }[] = [
  { key: 'mon', short: 'Mon' },
  { key: 'tue', short: 'Tue' },
  { key: 'wed', short: 'Wed' },
  { key: 'thu', short: 'Thu' },
  { key: 'fri', short: 'Fri' },
  { key: 'sat', short: 'Sat' },
  { key: 'sun', short: 'Sun' },
]

interface ActiveCell {
  projectId: string
  day: DayKey
}

// Pending change entry - stored in ref, survives React re-renders
interface PendingChange {
  value: string // Raw string input from user
  parsedHours: number | null // Validated hours (null if invalid)
  status: 'dirty' | 'queued' | 'saving' | 'synced' | 'error'
  timestamp: number
}

// Helper to format hours to display .25, .5, .75 instead of .3, .8
const formatHours = (hours: number): string => {
  if (hours === 0) return ''
  // Round to nearest 0.25
  const rounded = Math.round(hours * 4) / 4
  // Format to show proper quarters
  if (Number.isInteger(rounded)) return rounded.toString()
  const decimal = rounded - Math.floor(rounded)
  if (decimal === 0.25) return `${Math.floor(rounded)}.25`
  if (decimal === 0.5) return `${Math.floor(rounded)}.5`
  if (decimal === 0.75) return `${Math.floor(rounded)}.75`
  return rounded.toString()
}

// Parse and validate hours input
const parseHoursInput = (value: string): number | null => {
  if (!value || value.trim() === '') return 0
  const hours = parseFloat(value)
  if (isNaN(hours)) return null
  // Round to nearest 0.25 and clamp to 0-24
  const rounded = Math.round(hours * 4) / 4
  return Math.max(0, Math.min(24, rounded))
}

export function TimesheetGrid() {
  // Default to current week (Monday start)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  // Active cell for editing and notes
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [notes, setNotes] = useState<string>('')
  const [isBillable, setIsBillable] = useState<boolean>(true)

  // ========== REF-BASED PENDING CHANGES STORE (survives React re-renders) ==========
  const pendingChangesRef = useRef<Map<string, PendingChange>>(new Map())
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const invalidateTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Force re-render trigger (only for UI updates, not data storage)
  const [_renderTrigger, setRenderTrigger] = useState(0)
  const triggerRender = useCallback(() => setRenderTrigger((n) => n + 1), [])

  // Ref for notes container to handle clicks outside
  const notesRef = useRef<HTMLDivElement>(null)

  // Fetch weekly grid data
  const { data: gridData, isLoading } = trpc.timesheet.getWeeklyGrid.useQuery({
    weekStartDate: weekStart.toISOString(),
  })

  // Fetch user defaults for billable
  const { data: userDefaults } = trpc.project.getDefaults.useQuery(undefined, {
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Get utils for cache manipulation
  const utils = trpc.useUtils()

  // Reset to events mutation
  const resetToEventsMutation = trpc.timesheet.resetToEvents.useMutation({
    onSuccess: (data) => {
      alert(`Successfully reset! Removed ${data.deletedCount} manual entries.`)
      // Invalidate the grid to refresh data
      utils.timesheet.getWeeklyGrid.invalidate({ weekStartDate: weekStart.toISOString() })
    },
    onError: (error) => {
      alert(`Failed to reset: ${error.message}`)
    },
  })

  // Update cell mutation - simple, no complex state management
  const updateCellMutation = trpc.timesheet.updateCell.useMutation({
    onSuccess: (_data: unknown, variables: { date: string; projectId: string; hours: number; notes?: string; isBillable?: boolean }) => {
      const dayName = format(new Date(variables.date), 'EEE').toLowerCase()
      const key = `${variables.projectId}-${dayName}`

      // Mark as synced with timestamp (keep entry, don't delete immediately)
      const change = pendingChangesRef.current.get(key)
      if (change && change.status === 'saving') {
        change.status = 'synced'
        change.timestamp = Date.now() // Mark when synced for cleanup later
      }
      triggerRender()
    },
    onError: (err: unknown, variables: { date: string; projectId: string; hours: number; notes?: string; isBillable?: boolean }) => {
      const dayName = format(new Date(variables.date), 'EEE').toLowerCase()
      const key = `${variables.projectId}-${dayName}`
      console.error(`Failed to save ${key}:`, err)

      // Mark as error but keep the value so user can retry
      const change = pendingChangesRef.current.get(key)
      if (change) {
        change.status = 'error'
      }
      triggerRender()
    },
  })

  // ========== SYNC COORDINATOR ==========
  const processPendingChanges = useCallback(() => {
    let hasChangesToSync = false
    let hasSavingChanges = false

    // Find all queued changes and send them
    pendingChangesRef.current.forEach((change, key) => {
      if (change.status === 'queued' && change.parsedHours !== null) {
        hasChangesToSync = true
        change.status = 'saving'

        const [projectId, dayKey] = key.split('-') as [string, DayKey]
        const dayIndex = DAY_NAMES.findIndex((d) => d.key === dayKey)
        const cellDate = new Date(weekStart)
        cellDate.setDate(cellDate.getDate() + dayIndex)

        updateCellMutation.mutate({
          projectId,
          date: cellDate.toISOString(),
          hours: change.parsedHours,
          notes: activeCell?.projectId === projectId && activeCell?.day === dayKey ? notes : undefined,
          isBillable: activeCell?.projectId === projectId && activeCell?.day === dayKey ? isBillable : undefined,
        })
      }
      if (change.status === 'saving') {
        hasSavingChanges = true
      }
    })

    if (hasChangesToSync) {
      triggerRender()
    }

    // Invalidate cache immediately after all saves complete
    if (!hasSavingChanges && !hasChangesToSync) {
      // All saves completed, invalidate cache immediately
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current)
      }
      // Check if there are any non-synced/non-error changes
      let hasPending = false
      pendingChangesRef.current.forEach((change) => {
        if (change.status !== 'synced' && change.status !== 'error') {
          hasPending = true
        }
      })
      if (!hasPending) {
        utils.timesheet.getWeeklyGrid.invalidate({ weekStartDate: weekStart.toISOString() })
      }
      invalidateTimerRef.current = null
    }

    // Clean up synced entries after 2 seconds (once cache is fresh)
    pendingChangesRef.current.forEach((change, key) => {
      if (change.status === 'synced') {
        const timeSinceSynced = Date.now() - change.timestamp
        if (timeSinceSynced > 2000) {
          pendingChangesRef.current.delete(key)
        }
      }
    })
  }, [weekStart, updateCellMutation, activeCell, notes, isBillable, utils, triggerRender]);

  // Start sync coordinator on mount
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      processPendingChanges()
    }, 100) // Check every 100ms for changes to sync

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current)
      }
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current)
      }
    }
  }, [processPendingChanges])

  // ========== HELPER TO CHECK PENDING STATE ==========
  const getPendingChange = useCallback((key: string): PendingChange | undefined => {
    return pendingChangesRef.current.get(key)
  }, [])

  const hasPendingSaves = useCallback(() => {
    let pending = false
    pendingChangesRef.current.forEach((change) => {
      if (change.status === 'dirty' || change.status === 'queued' || change.status === 'saving') {
        pending = true
      }
    })
    return pending
  }, [])

  // Navigate weeks
  const handlePrevWeek = () => {
    setWeekStart((prev) => subWeeks(prev, 1))
  }

  const handleNextWeek = () => {
    setWeekStart((prev) => addWeeks(prev, 1))
  }

  const handleThisWeek = () => {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  // Handle clicks outside notes to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notesRef.current && !notesRef.current.contains(event.target as Node)) {
        // Check if click was on a cell
        const target = event.target as HTMLElement
        const isCell = target.closest('td')
        if (!isCell || !activeCell) {
          setActiveCell(null)
          setNotes('')
          setIsBillable(userDefaults?.isBillable ?? true)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [activeCell, userDefaults])

  // Handle cell click
  const handleCellClick = (projectId: string, day: DayKey) => {
    // Activate cell and load notes
    setActiveCell({ projectId, day })

    // Load existing notes and billable from the first entry for this project/day
    const project = gridData?.projects.find((p: { id: string }) => p.id === projectId)
    const existingNotes = project?.notes[day] || ''
    setNotes(existingNotes)

    // Set billable to user defaults
    setIsBillable(userDefaults?.isBillable ?? true)
  }

  // Handle input change - write directly to ref store (never lost)
  const handleInputChange = useCallback((projectId: string, day: DayKey, value: string) => {
    const key = `${projectId}-${day}`

    // Parse the value immediately for validation feedback
    const parsedHours = parseHoursInput(value)

    // Write to ref store - this survives any React re-render
    pendingChangesRef.current.set(key, {
      value,
      parsedHours,
      status: 'dirty', // Mark as dirty, not yet queued for sync
      timestamp: Date.now(),
    })

    // Trigger render to show the new value
    triggerRender()
  }, [triggerRender])

  // Handle input focus - no special handling needed with ref store
  const handleInputFocus = useCallback((_projectId: string, _day: DayKey) => {
    // Nothing to do - the pending store already has the value if any
  }, [])

  // Handle blur - mark as ready to sync
  const handleInputBlur = useCallback((projectId: string, day: DayKey, _value: string) => {
    const key = `${projectId}-${day}`
    const change = pendingChangesRef.current.get(key)

    if (change && change.status === 'dirty') {
      // Validate before queueing
      if (change.parsedHours !== null) {
        // Valid input - queue for sync
        change.status = 'queued'
        // Update display value to show rounded version
        change.value = formatHours(change.parsedHours)
      } else {
        // Invalid input - remove from pending and show error
        pendingChangesRef.current.delete(key)
      }
      triggerRender()
    }
  }, [triggerRender])

  // Handle enter key
  const handleKeyDown = useCallback((e: React.KeyboardEvent, projectId: string, day: DayKey) => {
    if (e.key === 'Enter') {
      const key = `${projectId}-${day}`
      const change = pendingChangesRef.current.get(key)

      if (change && change.status === 'dirty' && change.parsedHours !== null) {
        change.status = 'queued'
        change.value = formatHours(change.parsedHours)
        triggerRender()
      }
      ;(e.target as HTMLInputElement).blur()
    } else if (e.key === 'Tab') {
      // On tab, mark current cell as queued before moving to next
      const key = `${projectId}-${day}`
      const change = pendingChangesRef.current.get(key)

      if (change && change.status === 'dirty' && change.parsedHours !== null) {
        change.status = 'queued'
        change.value = formatHours(change.parsedHours)
        triggerRender()
      }
      // Don't prevent default - let tab move to next cell naturally
    }
  }, [triggerRender])

  // Handle notes save
  const handleNotesSave = () => {
    if (!activeCell) return

    const project = gridData?.projects.find((p: { id: string }) => p.id === activeCell.projectId)
    if (!project) return

    const currentHours = project.dailyHours[activeCell.day]

    // Calculate the date for this day
    const dayIndex = DAY_NAMES.findIndex((d) => d.key === activeCell.day)
    const cellDate = new Date(weekStart)
    cellDate.setDate(cellDate.getDate() + dayIndex)

    // Update with notes and billable
    updateCellMutation.mutate({
      projectId: activeCell.projectId,
      date: cellDate.toISOString(),
      hours: currentHours,
      notes: notes,
      isBillable: isBillable,
    })
  }

  // Get dates for headers
  const getDayDate = (dayIndex: number) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + dayIndex)
    return format(date, 'dd MMM')
  }

  // Calculate adjusted totals including pending changes
  const getAdjustedWeeklyTotal = (project: NonNullable<typeof gridData>['projects'][0]) => {
    let total = 0
    DAY_NAMES.forEach((day) => {
      const key = `${project.id}-${day.key}`
      const pendingChange = getPendingChange(key)
      const hasPending = pendingChange !== undefined && pendingChange.parsedHours !== null
      const hours = hasPending ? (pendingChange.parsedHours ?? 0) : (project.dailyHours[day.key] || 0)
      total += hours
    })
    return total
  }

  const getAdjustedDailyTotal = (dayKey: DayKey) => {
    if (!gridData) return 0
    let total = 0
    gridData.projects.forEach((project: { id: string; dailyHours: Record<DayKey, number> }) => {
      const key = `${project.id}-${dayKey}`
      const pendingChange = getPendingChange(key)
      const hasPending = pendingChange !== undefined && pendingChange.parsedHours !== null
      const hours = hasPending ? (pendingChange.parsedHours ?? 0) : (project.dailyHours[dayKey] || 0)
      total += hours
    })
    return total
  }

  if (isLoading) {
    return (
      <div className="max-w-full mx-auto">
        <div className="text-center py-12 animate-fade-in">
          <div className="spinner h-16 w-16 mx-auto"></div>
          <p className="mt-lg text-text-secondary font-medium">Loading timesheet...</p>
          <div className="mt-md flex items-center justify-center gap-sm">
            <div className="w-2 h-2 bg-accent-orange rounded-full animate-bounce" />
            <div className="w-2 h-2 bg-accent-purple rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
            <div className="w-2 h-2 bg-accent-blue rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
          </div>
        </div>
      </div>
    )
  }

  if (!gridData) {
    return (
      <div className="max-w-full mx-auto">
        <div className="text-center py-12 text-text-secondary animate-fade-in">No data available</div>
      </div>
    )
  }

  const isThisWeek =
    format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  // Handle reset to events
  const handleResetToEvents = () => {
    if (!confirm('Are you sure you want to reset this week to events only? This will remove all manual entries and cannot be undone.')) {
      return
    }
    resetToEventsMutation.mutate({ weekStartDate: weekStart.toISOString() })
  }

  return (
    <div className="max-w-full mx-auto animate-fade-in-up">
      {/* Header */}
      <div className="mb-xl flex justify-between items-center">
        <div className="animate-slide-in-left">
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Weekly Timesheet</h1>
          <p className="text-text-secondary mt-xs text-sm flex items-center gap-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
            {isThisWeek && <span className="ml-sm badge badge-warning animate-pulse">This week</span>}
          </p>
        </div>

        {/* Week Navigation & Actions */}
        <div className="flex items-center gap-md animate-slide-in-right">
          {/* Global save indicator */}
          {hasPendingSaves() && (
            <div className="flex items-center gap-sm px-md py-sm bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg shadow-sm animate-scale-in">
              <div className="spinner w-4 h-4" />
              <span className="text-sm text-blue-700 font-medium">Saving...</span>
            </div>
          )}
          <div className="flex gap-sm">
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
            <button
              onClick={handleResetToEvents}
              disabled={resetToEventsMutation.isPending}
              className="bg-gradient-to-r from-orange-500 to-orange-600 text-white border-none px-lg py-sm rounded-lg text-sm font-medium cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-sm"
              title="Remove all manual entries and keep only event-sourced hours"
            >
              {resetToEventsMutation.isPending ? (
                <>
                  <div className="spinner w-4 h-4" />
                  Resetting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset to Events
                </>
              )}
            </button>
            <RMSyncButton
              weekStart={weekStart}
              onSyncComplete={() => {
                // Invalidate the grid to refresh data after sync
                utils.timesheet.getWeeklyGrid.invalidate({ weekStartDate: weekStart.toISOString() })
              }}
            />
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-lg flex items-center gap-lg text-sm text-text-secondary">
        <span className="font-medium text-text-primary">Cell colors:</span>
        <div className="flex items-center gap-sm">
          <div className="w-4 h-4 bg-blue-50 border border-border-medium rounded"></div>
          <span>From events</span>
        </div>
        <div className="flex items-center gap-sm">
          <div className="w-4 h-4 bg-orange-50 border border-border-medium rounded"></div>
          <span>Manual entry</span>
        </div>
        <div className="flex items-center gap-sm">
          <div className="w-4 h-4 bg-yellow-50 border border-border-medium rounded"></div>
          <span>Mixed (events + manual)</span>
        </div>
      </div>

      {/* Grid Table */}
      <div className="bg-white rounded-lg border border-border-light shadow-sm overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-light bg-sandy">
              <th className="text-left p-lg font-medium text-text-primary border-r border-border-light min-w-[250px]">
                Project
              </th>
              {DAY_NAMES.map((day, index) => (
                <th
                  key={day.key}
                  className="text-center p-lg font-medium text-text-primary border-r border-border-light min-w-[100px]"
                >
                  <div>{day.short}</div>
                  <div className="text-xs font-normal text-text-tertiary mt-xs">
                    {getDayDate(index)}
                  </div>
                </th>
              ))}
              <th className="text-center p-lg font-medium text-text-primary min-w-[100px]">
                Weekly Total
              </th>
            </tr>
          </thead>
          <tbody>
            {gridData.projects.map((project: { id: string; name: string; dailyHours: Record<DayKey, number>; notes: Record<DayKey, string>; eventHours: Record<DayKey, number>; manualHours: Record<DayKey, number> }) => (
              <tr key={project.id} className="border-b border-border-light hover:bg-bg-hover transition-colors duration-150">
                <td className="p-lg border-r border-border-light">
                  <div className="font-medium text-text-primary">{project.name}</div>
                </td>
                {DAY_NAMES.map((day) => {
                  const serverHours = project.dailyHours[day.key]
                  const eventHrs = project.eventHours[day.key] || 0
                  const manualHrs = project.manualHours[day.key] || 0
                  const isActive = activeCell?.projectId === project.id && activeCell?.day === day.key
                  const key = `${project.id}-${day.key}`

                  // Check pending changes store (ref-based, survives re-renders)
                  const pendingChange = getPendingChange(key)
                  const hasPending = pendingChange !== undefined
                  const isSaving = pendingChange?.status === 'saving'
                  const isQueued = pendingChange?.status === 'queued'
                  const isDirty = pendingChange?.status === 'dirty'
                  const hasError = pendingChange?.status === 'error'

                  // Use pending value if available, otherwise server value
                  const hours = hasPending && pendingChange.parsedHours !== null
                    ? pendingChange.parsedHours
                    : serverHours

                  // Determine cell type for visual styling
                  const hasEvents = eventHrs > 0
                  const hasManual = manualHrs > 0 || (hasPending && pendingChange.parsedHours !== null && pendingChange.parsedHours > 0)
                  const cellType = hasEvents && hasManual ? 'mixed' : hasEvents ? 'event' : hasManual ? 'manual' : 'empty'

                  // Display logic:
                  // 1. If cell has pending change, show pending value
                  //    - For dirty: show raw string (user is typing)
                  //    - For queued/saving/synced: show formatted value
                  // 2. Otherwise, show formatted hours from server cache
                  const displayValue = hasPending
                    ? (pendingChange.status === 'dirty' ? pendingChange.value : formatHours(pendingChange.parsedHours || 0))
                    : formatHours(serverHours)

                  // Build tooltip showing breakdown and status
                  const statusText = isSaving ? ' | Saving...' : isQueued ? ' | Queued' : isDirty ? ' | Unsaved' : hasError ? ' | Error!' : ''
                  const tooltipText = hours > 0
                    ? `Total: ${formatHours(hours)}h${eventHrs > 0 ? ` | Events: ${formatHours(eventHrs)}h` : ''}${manualHrs > 0 ? ` | Manual: ${formatHours(manualHrs)}h` : ''}${statusText}`
                    : 'Click to add hours'

                  return (
                    <td
                      key={day.key}
                      className={`text-center p-sm border-r border-border-light cursor-pointer relative ${
                        cellType === 'event' ? 'bg-blue-50' :
                        cellType === 'mixed' ? 'bg-yellow-50' :
                        cellType === 'manual' ? 'bg-orange-50' :
                        'bg-bg-secondary'
                      } ${
                        isActive ? 'ring-2 ring-accent-orange ring-inset' : ''
                      } ${
                        isSaving ? 'opacity-75' : ''
                      } ${
                        hasError ? 'bg-red-50' : ''
                      }`}
                      onClick={() => handleCellClick(project.id, day.key)}
                      title={tooltipText}
                    >
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="24"
                        value={displayValue}
                        onChange={(e) => handleInputChange(project.id, day.key, e.target.value)}
                        onBlur={(e) => handleInputBlur(project.id, day.key, e.target.value)}
                        onFocus={(e) => {
                          e.target.select()
                          handleInputFocus(project.id, day.key)
                        }}
                        onKeyDown={(e) => handleKeyDown(e, project.id, day.key)}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-full text-center bg-transparent outline-none ${
                          hours > 0 ? 'font-medium text-text-primary' : 'text-text-tertiary'
                        } ${
                          hasError ? 'text-red-600' : ''
                        } [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                        placeholder="0.0"
                      />
                      {(isSaving || isQueued) && (
                        <div className="absolute top-0 right-0 w-2 h-2 bg-blue-500 rounded-full animate-pulse" title={isSaving ? 'Saving...' : 'Queued'} />
                      )}
                      {isDirty && (
                        <div className="absolute top-0 right-0 w-2 h-2 bg-yellow-500 rounded-full" title="Unsaved" />
                      )}
                      {hasError && (
                        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full" title="Error - will retry" />
                      )}
                    </td>
                  )
                })}
                <td className="text-center p-lg font-medium text-text-primary border-border-light">
                  {formatHours(getAdjustedWeeklyTotal(project))}
                </td>
              </tr>
            ))}

            {/* Daily Totals Row */}
            <tr className="border-t-2 border-border-medium bg-sandy font-medium">
              <td className="p-lg border-r border-border-light text-text-primary">Daily Total</td>
              {DAY_NAMES.map((day) => {
                const total = getAdjustedDailyTotal(day.key)
                const target = gridData.targetHoursPerDay
                const isUnderTarget = total < target

                return (
                  <td
                    key={day.key}
                    className="text-center p-lg border-r border-border-light"
                  >
                    <div className={isUnderTarget ? 'text-red-600' : 'text-text-primary'}>
                      {formatHours(total)}
                    </div>
                    {isUnderTarget && (
                      <div className="text-red-500 text-xs mt-xs">▲</div>
                    )}
                  </td>
                )
              })}
              <td className="text-center p-lg text-text-primary">
                {formatHours(DAY_NAMES.reduce((sum, day) => sum + getAdjustedDailyTotal(day.key), 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes Field (shown as dropdown when cell is active) */}
      {activeCell && (
        <div ref={notesRef} className="mt-lg bg-white rounded-lg border border-border-light shadow-md overflow-hidden">
          <div className="bg-sandy px-lg py-md border-b border-border-light">
            <label className="block text-sm font-medium text-text-primary">
              Details for {gridData.projects.find((p: { id: string; name: string }) => p.id === activeCell.projectId)?.name} - {DAY_NAMES.find((d) => d.key === activeCell.day)?.short}
            </label>
          </div>
          <div className="p-lg">

          {/* Billable Toggle and Phase Input */}
          <div className="flex items-center gap-md mb-md">
            <label className="flex items-center gap-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isBillable}
                onChange={(e) => setIsBillable(e.target.checked)}
                className="w-4 h-4 text-accent-orange border-border-medium rounded focus:ring-accent-orange"
              />
              <span className="text-sm text-text-primary">Billable</span>
            </label>
          </div>

          {/* Notes Textarea */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Enter notes for this entry..."
            className="w-full px-md py-sm border border-border-medium rounded-md focus:outline-none focus:border-text-secondary"
            rows={3}
          />
          <div className="flex justify-end gap-sm">
            <button
              onClick={() => {
                setActiveCell(null)
                setNotes('')
                setIsBillable(userDefaults?.isBillable ?? true)
              }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleNotesSave}
              disabled={updateCellMutation.isPending}
              className="btn-primary text-sm"
            >
              {updateCellMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
