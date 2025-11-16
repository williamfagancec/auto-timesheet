import { useState, useEffect, useRef } from 'react'
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

export function TimesheetGrid() {
  // Default to current week (Monday start)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  // Active cell for editing and notes
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [notes, setNotes] = useState<string>('')
  const [isBillable, setIsBillable] = useState<boolean>(true)
  const [phase, setPhase] = useState<string>('')

  // Pending input value (for validation on blur/enter)
  const [pendingValue, setPendingValue] = useState<{ [key: string]: string }>({})

  // Track which cells are currently being edited to prevent display flicker during save
  const [editingCells, setEditingCells] = useState<Set<string>>(new Set())

  // Ref for notes container to handle clicks outside
  const notesRef = useRef<HTMLDivElement>(null)

  // Fetch weekly grid data
  const { data: gridData, isLoading } = trpc.timesheet.getWeeklyGrid.useQuery({
    weekStartDate: weekStart.toISOString(),
  })

  // Clear editing state when fresh data arrives from server
  useEffect(() => {
    if (gridData && !isLoading) {
      // Clear all editing states and pending values when new data is loaded
      setEditingCells(new Set())
      setPendingValue({})
    }
  }, [gridData, isLoading])

  // Fetch user defaults for billable and phase
  const { data: userDefaults } = trpc.project.getDefaults.useQuery(undefined, {
    retry: 1,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Get utils for cache manipulation
  const utils = trpc.useUtils()

  // Update cell mutation - simplified without complex optimistic updates
  // The API handles aggregation of multiple entries per day, so we can't
  // accurately predict the final value client-side
  const updateCellMutation = trpc.timesheet.updateCell.useMutation({
    onSuccess: () => {
      // Refetch grid data to get accurate aggregated values from server
      utils.timesheet.getWeeklyGrid.invalidate({ weekStartDate: weekStart.toISOString() })
    },
    onError: (err) => {
      console.error('Failed to update timesheet cell:', err)
      alert('Failed to update timesheet. Please try again.')
      // Clear editing state on error
      setEditingCells(new Set())
    },
  })

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

  // Handle input change (just update local state, don't save yet)
  const handleInputChange = (projectId: string, day: DayKey, value: string) => {
    const key = `${projectId}-${day}`
    setPendingValue((prev) => ({ ...prev, [key]: value }))

    // Mark this cell as being edited
    setEditingCells((prev) => new Set(prev).add(key))
  }

  // Handle input focus - mark as editing
  const handleInputFocus = (projectId: string, day: DayKey) => {
    const key = `${projectId}-${day}`
    setEditingCells((prev) => new Set(prev).add(key))
  }

  // Handle blur or enter key (validate and save)
  const handleInputBlur = (projectId: string, day: DayKey, value: string) => {
    const key = `${projectId}-${day}`

    if (!value || value.trim() === '') {
      // Empty value - send 0 hours to delete manual entries
      const dayIndex = DAY_NAMES.findIndex((d) => d.key === day)
      const cellDate = new Date(weekStart)
      cellDate.setDate(cellDate.getDate() + dayIndex)

      // Update cell on server with 0 hours
      updateCellMutation.mutate({
        projectId,
        date: cellDate.toISOString(),
        hours: 0,
        notes: activeCell?.projectId === projectId && activeCell?.day === day ? notes : undefined,
        isBillable: activeCell?.projectId === projectId && activeCell?.day === day ? isBillable : undefined,
        phase: activeCell?.projectId === projectId && activeCell?.day === day ? (phase || undefined) : undefined,
      })

      // Keep cell in editing state until server responds
      return
    }

    // Parse hours (allow decimal values in 0.25 increments)
    const hours = parseFloat(value)

    if (isNaN(hours)) {
      alert('Please enter a valid number')
      // Clear editing state and pending value
      setPendingValue((prev) => {
        const newState = { ...prev }
        delete newState[key]
        return newState
      })
      setEditingCells((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
      return
    }

    // Round to nearest 0.25 (15 minutes)
    const roundedHours = Math.round(hours * 4) / 4

    // Validate range (0-24 hours)
    if (roundedHours < 0 || roundedHours > 24) {
      alert('Hours must be between 0 and 24')
      // Clear editing state and pending value
      setPendingValue((prev) => {
        const newState = { ...prev }
        delete newState[key]
        return newState
      })
      setEditingCells((prev) => {
        const newSet = new Set(prev)
        newSet.delete(key)
        return newSet
      })
      return
    }

    // Calculate the date for this day
    const dayIndex = DAY_NAMES.findIndex((d) => d.key === day)
    const cellDate = new Date(weekStart)
    cellDate.setDate(cellDate.getDate() + dayIndex)

    // Update pending value to show rounded value immediately
    setPendingValue((prev) => ({ ...prev, [key]: formatHours(roundedHours) }))

    // Update cell on server (editing state will be cleared when data refetches)
    updateCellMutation.mutate({
      projectId,
      date: cellDate.toISOString(),
      hours: roundedHours,
      notes: activeCell?.projectId === projectId && activeCell?.day === day ? notes : undefined,
      isBillable: activeCell?.projectId === projectId && activeCell?.day === day ? isBillable : undefined,
      phase: activeCell?.projectId === projectId && activeCell?.day === day ? (phase || undefined) : undefined,
    })
  }

  // Handle enter key
  const handleKeyDown = (e: React.KeyboardEvent, projectId: string, day: DayKey, value: string) => {
    if (e.key === 'Enter') {
      handleInputBlur(projectId, day, value)
      ;(e.target as HTMLInputElement).blur()
    }
  }

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
                  const hours = project.dailyHours[day.key]
                  const eventHrs = project.eventHours[day.key] || 0
                  const manualHrs = project.manualHours[day.key] || 0
                  const isActive = activeCell?.projectId === project.id && activeCell?.day === day.key
                  const key = `${project.id}-${day.key}`
                  const isEditing = editingCells.has(key)

                  // Determine cell type for visual styling
                  const hasEvents = eventHrs > 0
                  const hasManual = manualHrs > 0
                  const cellType = hasEvents && hasManual ? 'mixed' : hasEvents ? 'event' : hasManual ? 'manual' : 'empty'

                  // Display logic:
                  // 1. If cell is being edited AND has pending value, show pending value
                  // 2. Otherwise, show formatted hours from server
                  const displayValue = (isEditing && pendingValue[key] !== undefined)
                    ? pendingValue[key]
                    : formatHours(hours)

                  // Build tooltip showing breakdown
                  const tooltipText = hours > 0
                    ? `Total: ${formatHours(hours)}h${eventHrs > 0 ? ` | Events: ${formatHours(eventHrs)}h` : ''}${manualHrs > 0 ? ` | Manual: ${formatHours(manualHrs)}h` : ''}`
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
                        onKeyDown={(e) => handleKeyDown(e, project.id, day.key, e.currentTarget.value)}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-full text-center bg-transparent outline-none ${
                          hours > 0 ? 'font-medium text-gray-900' : 'text-gray-400'
                        } [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                        placeholder="0.0"
                      />
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
