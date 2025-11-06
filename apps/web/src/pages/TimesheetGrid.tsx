import { useState } from 'react'
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

export function TimesheetGrid() {
  // Default to current week (Monday start)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  // Active cell for editing and notes
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const [notes, setNotes] = useState<string>('')

  // Fetch weekly grid data
  const { data: gridData, isLoading, refetch } = trpc.timesheet.getWeeklyGrid.useQuery({
    weekStartDate: weekStart.toISOString(),
  })

  // Update cell mutation
  const updateCellMutation = trpc.timesheet.updateCell.useMutation({
    onSuccess: () => {
      refetch()
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

  // Handle cell click
  const handleCellClick = (projectId: string, day: DayKey) => {
    if (activeCell?.projectId === projectId && activeCell?.day === day) {
      // Clicking the same cell - deactivate
      setActiveCell(null)
      setNotes('')
    } else {
      // Activate new cell
      setActiveCell({ projectId, day })

      // Load existing notes
      const project = gridData?.projects.find((p) => p.id === projectId)
      const existingNotes = project?.notes[day] || ''
      setNotes(existingNotes)
    }
  }

  // Handle cell value change
  const handleCellChange = (projectId: string, day: DayKey, value: string) => {
    // Parse hours (allow decimal values in 0.25 increments)
    const hours = parseFloat(value) || 0

    // Round to nearest 0.25 (15 minutes)
    const roundedHours = Math.round(hours * 4) / 4

    // Validate range (0-24 hours)
    if (roundedHours < 0 || roundedHours > 24) {
      alert('Hours must be between 0 and 24')
      return
    }

    // Calculate the date for this day
    const dayIndex = DAY_NAMES.findIndex((d) => d.key === day)
    const cellDate = new Date(weekStart)
    cellDate.setDate(cellDate.getDate() + dayIndex)

    // Update cell
    updateCellMutation.mutate({
      projectId,
      date: cellDate.toISOString(),
      hours: roundedHours,
      notes: activeCell?.projectId === projectId && activeCell?.day === day ? notes : undefined,
    })
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

    // Update with notes
    updateCellMutation.mutate({
      projectId: activeCell.projectId,
      date: cellDate.toISOString(),
      hours: currentHours,
      notes: notes,
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

        {/* Week Navigation */}
        <div className="flex items-center gap-2">
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
                  const isActive = activeCell?.projectId === project.id && activeCell?.day === day.key

                  return (
                    <td
                      key={day.key}
                      className={`text-center p-2 border-r cursor-pointer ${
                        hours > 0 ? 'bg-white' : 'bg-gray-50'
                      } ${
                        isActive ? 'ring-2 ring-blue-500 ring-inset' : ''
                      }`}
                      onClick={() => handleCellClick(project.id, day.key)}
                    >
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        max="24"
                        value={
                          hours > 0
                          ? (Number.isInteger(hours)
                            ? hours.toString()
                            : hours.toFixed(2).replace(/\.?0+$/, ''))
                          : ''
                        }
                        onChange={(e) => handleCellChange(project.id, day.key, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-full text-center bg-transparent outline-none ${
                          hours > 0 ? 'font-medium text-gray-900' : 'text-gray-400'
                        }`}
                        placeholder="0.0"
                      />
                    </td>
                  )
                })}
                <td className="text-center p-4 font-medium text-gray-900">
                  {project.weeklyTotal.toFixed(1)}
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
                      {total.toFixed(1)}
                    </div>
                    {isUnderTarget && (
                      <div className="text-red-500 text-xs mt-1">▲</div>
                    )}
                  </td>
                )
              })}
              <td className="text-center p-4 text-gray-900">
                {Object.values(gridData.dailyTotals).reduce((sum, val) => sum + val, 0).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Notes Field (shown when cell is active) */}
      {activeCell && (
        <div className="mt-4 bg-gray-50 p-4 rounded-lg border">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Notes for {gridData.projects.find((p) => p.id === activeCell.projectId)?.name} - {DAY_NAMES.find((d) => d.key === activeCell.day)?.short}
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Enter note"
            className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={3}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => {
                setActiveCell(null)
                setNotes('')
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
              {updateCellMutation.isPending ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-gray-700">
          <strong>Tip:</strong> Click a cell to add hours (in 15-minute increments: 0.25, 0.5, 0.75, 1.0, etc.).
          Click the cell again to add notes. Hours are automatically saved when you change the value.
        </p>
      </div>
    </div>
  )
}
