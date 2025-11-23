import { useState, useEffect, useRef, useCallback } from 'react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns'
import { trpc } from '../lib/trpc'

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
  const [phase, setPhase] = useState<string>('')

  // ========== REF-BASED PENDING CHANGES STORE (survives React re-renders) ==========
  const pendingChangesRef = useRef<Map<string, PendingChange>>(new Map())
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const invalidateTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Force re-render trigger (only for UI updates, not data storage)
  const [renderTrigger, setRenderTrigger] = useState(0)
  const triggerRender = useCallback(() => setRenderTrigger((n) => n + 1), [])

  // Ref for notes container to handle clicks outside
  const notesRef = useRef<HTMLDivElement>(null)

  // Fetch weekly grid data
  const { data: gridData, isLoading } = trpc.timesheet.getWeeklyGrid.useQuery({
    weekStartDate: weekStart.toISOString(),
  })

  // Fetch user defaults for billable and phase
  const { data: userDefaults } = trpc.project.getDefaults.useQuery(undefined, {
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Get utils for cache manipulation
  const utils = trpc.useUtils()

  // Update cell mutation - simple, no complex state management
  const updateCellMutation = trpc.timesheet.updateCell.useMutation({
    onSuccess: (_data, variables) => {
      const dayName = format(new Date(variables.date), 'EEE').toLowerCase()
      const key = `${variables.projectId}-${dayName}`

      // Mark as synced and schedule cleanup
      const change = pendingChangesRef.current.get(key)
      if (change && change.status === 'saving') {
        change.status = 'synced'
        // Remove synced entries after a short delay
        setTimeout(() => {
          const current = pendingChangesRef.current.get(key)
          if (current?.status === 'synced') {
            pendingChangesRef.current.delete(key)
            triggerRender()
          }
        }, 100)
      }
      triggerRender()
    },
    onError: (err, variables) => {
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
          phase: activeCell?.projectId === projectId && activeCell?.day === dayKey ? (phase || undefined) : undefined,
        })
      }
      if (change.status === 'saving') {
        hasSavingChanges = true
      }
    })

    if (hasChangesToSync) {
      triggerRender()
    }

    // Schedule cache invalidation after all saves complete
    if (!hasSavingChanges && !hasChangesToSync) {
      // All saves completed, invalidate cache
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current)
      }
      invalidateTimerRef.current = setTimeout(() => {
        // Only invalidate if no pending changes
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
      }, 500)
    }
  }, [weekStart, updateCellMutation, activeCell, notes, isBillable, phase, utils, triggerRender])

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
          setPhase(userDefaults?.phase ?? '')
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

    // Load existing notes and billable/phase from the first entry for this project/day
    const project = gridData?.projects.find((p) => p.id === projectId)
    const existingNotes = project?.notes[day] || ''
    setNotes(existingNotes)

    // Set billable and phase to user defaults
    setIsBillable(userDefaults?.isBillable ?? true)
    setPhase(userDefaults?.phase ?? '')
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

    const project = gridData?.projects.find((p) => p.id === activeCell.projectId)
    if (!project) return

    const currentHours = project.dailyHours[activeCell.day]

    // Calculate the date for this day
    const dayIndex = DAY_NAMES.findIndex((d) => d.key === activeCell.day)
    const cellDate = new Date(weekStart)
    cellDate.setDate(cellDate.getDate() + dayIndex)

    // Update with notes, billable, and phase
    updateCellMutation.mutate({
      projectId: activeCell.projectId,
      date: cellDate.toISOString(),
      hours: currentHours,
      notes: notes,
      isBillable: isBillable,
      phase: phase || undefined,
    })
  }

  // Get dates for headers
  const getDayDate = (dayIndex: number) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + dayIndex)
    return format(date, 'dd MMM')
  }

  if (isLoading) {
    return (
      <div className="max-w-full mx-auto p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading timesheet...</p>
        </div>
      </div>
    )
  }

  if (!gridData) {
    return (
      <div className="max-w-full mx-auto p-8">
        <div className="text-center py-12 text-gray-600">No data available</div>
      </div>
    )
  }

  const isThisWeek =
    format(weekStart, 'yyyy-MM-dd') === format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  return (
    <div className="max-w-full mx-auto p-8">
      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Weekly Timesheet</h1>
          <p className="text-gray-600 mt-1">
            {format(weekStart, 'MMMM d')} - {format(weekEnd, 'MMMM d, yyyy')}
            {isThisWeek && <span className="ml-2 text-sm text-blue-600 font-medium">(This week)</span>}
          </p>
        </div>

        {/* Week Navigation & Actions */}
        <div className="flex items-center gap-3">
          {/* Global save indicator */}
          {hasPendingSaves() && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
              <span>Saving...</span>
            </div>
          )}
          <div className="flex gap-2">
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
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex items-center gap-6 text-sm text-gray-600">
        <span className="font-medium">Cell colors:</span>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-50 border border-gray-300 rounded"></div>
          <span>From events</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-50 border border-gray-300 rounded"></div>
          <span>Manual entry</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-yellow-50 border border-gray-300 rounded"></div>
          <span>Mixed (events + manual)</span>
        </div>
      </div>

      {/* Grid Table */}
      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-4 font-medium text-gray-700 border-r min-w-[250px]">
                Project
              </th>
              {DAY_NAMES.map((day, index) => (
                <th
                  key={day.key}
                  className="text-center p-4 font-medium text-gray-700 border-r min-w-[100px]"
                >
                  <div>{day.short}</div>
                  <div className="text-xs font-normal text-gray-500 mt-1">
                    {getDayDate(index)}
                  </div>
                </th>
              ))}
              <th className="text-center p-4 font-medium text-gray-700 min-w-[100px]">
                Weekly Total
              </th>
            </tr>
          </thead>
          <tbody>
            {gridData.projects.map((project) => (
              <tr key={project.id} className="border-b hover:bg-gray-50">
                <td className="p-4 border-r">
                  <div className="font-medium text-gray-900">{project.name}</div>
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
                  // 1. If cell has pending change, show pending value (raw string for dirty, formatted for queued/saving)
                  // 2. Otherwise, show formatted hours from server
                  const displayValue = hasPending
                    ? pendingChange.value
                    : formatHours(serverHours)

                  // Build tooltip showing breakdown and status
                  const statusText = isSaving ? ' | Saving...' : isQueued ? ' | Queued' : isDirty ? ' | Unsaved' : hasError ? ' | Error!' : ''
                  const tooltipText = hours > 0
                    ? `Total: ${formatHours(hours)}h${eventHrs > 0 ? ` | Events: ${formatHours(eventHrs)}h` : ''}${manualHrs > 0 ? ` | Manual: ${formatHours(manualHrs)}h` : ''}${statusText}`
                    : 'Click to add hours'

                  return (
                    <td
                      key={day.key}
                      className={`text-center p-2 border-r cursor-pointer relative ${
                        cellType === 'event' ? 'bg-blue-50' :
                        cellType === 'mixed' ? 'bg-yellow-50' :
                        cellType === 'manual' ? 'bg-orange-50' :
                        'bg-gray-50'
                      } ${
                        isActive ? 'ring-2 ring-blue-500 ring-inset' : ''
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
                          hours > 0 ? 'font-medium text-gray-900' : 'text-gray-400'
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
                <td className="text-center p-4 font-medium text-gray-900">
                  {formatHours(project.weeklyTotal)}
                </td>
              </tr>
            ))}

            {/* Daily Totals Row */}
            <tr className="border-t-2 bg-gray-50 font-medium">
              <td className="p-4 border-r text-gray-700">Daily Total</td>
              {DAY_NAMES.map((day) => {
                const total = gridData.dailyTotals[day.key]
                const target = gridData.targetHoursPerDay
                const isUnderTarget = total < target

                return (
                  <td
                    key={day.key}
                    className="text-center p-4 border-r"
                  >
                    <div className={isUnderTarget ? 'text-red-600' : 'text-gray-900'}>
                      {formatHours(total)}
                    </div>
                    {isUnderTarget && (
                      <div className="text-red-500 text-xs mt-1">▲</div>
                    )}
                  </td>
                )
              })}
              <td className="text-center p-4 text-gray-900">
                {formatHours(Object.values(gridData.dailyTotals).reduce((sum, val) => sum + val, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes Field (shown as dropdown when cell is active) */}
      {activeCell && (
        <div ref={notesRef} className="mt-4 bg-white p-4 rounded-lg border shadow-lg">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Details for {gridData.projects.find((p) => p.id === activeCell.projectId)?.name} - {DAY_NAMES.find((d) => d.key === activeCell.day)?.short}
          </label>

          {/* Billable Toggle and Phase Input */}
          <div className="flex items-center gap-4 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isBillable}
                onChange={(e) => setIsBillable(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Billable</span>
            </label>
            <input
              type="text"
              placeholder="Phase (optional)"
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="flex-1 px-3 py-1 text-sm border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Notes Textarea */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Enter notes for this entry..."
            className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={3}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setActiveCell(null)
                setNotes('')
                setIsBillable(userDefaults?.isBillable ?? true)
                setPhase(userDefaults?.phase ?? '')
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              onClick={handleNotesSave}
              disabled={updateCellMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {updateCellMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
