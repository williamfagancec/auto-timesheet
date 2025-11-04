import { useState } from 'react'
import { DateRangePreset, getDateRangeForPreset, DateRange, formatDateRange } from '../lib/dateUtils'

interface DateRangeSelectorProps {
  selectedRange: DateRange
  onRangeChange: (range: DateRange) => void
}

export function DateRangeSelector({ selectedRange, onRangeChange }: DateRangeSelectorProps) {
  const [activePreset, setActivePreset] = useState<DateRangePreset>('this-week')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const presets: Array<{ value: DateRangePreset; label: string }> = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'this-week', label: 'This Week' },
    { value: 'last-week', label: 'Last Week' },
    { value: 'custom', label: 'Custom' },
  ]

  const handlePresetClick = (preset: DateRangePreset) => {
    setActivePreset(preset)

    if (preset === 'custom') {
      setShowCustomPicker(true)
      return
    }

    const range = getDateRangeForPreset(preset)
    if (range) {
      onRangeChange(range)
      setShowCustomPicker(false)
    }
  }

  const handleCustomApply = () => {
    if (!customStart || !customEnd) return

    const startDate = new Date(customStart)
    startDate.setHours(0, 0, 0, 0)

    const endDate = new Date(customEnd)
    endDate.setHours(23, 59, 59, 999)

    onRangeChange({ startDate, endDate })
    setShowCustomPicker(false)
  }

  return (
    <div className="bg-white p-4 rounded-lg border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Date Range</h3>
        <span className="text-sm text-gray-600">
          {formatDateRange(selectedRange.startDate, selectedRange.endDate)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.value}
            onClick={() => handlePresetClick(preset.value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activePreset === preset.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {showCustomPicker && (
        <div className="mt-4 p-4 bg-gray-50 rounded-md border">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                id="start-date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                id="end-date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleCustomApply}
              disabled={!customStart || !customEnd}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300"
            >
              Apply
            </button>
            <button
              onClick={() => {
                setShowCustomPicker(false)
                setActivePreset('this-week')
                const range = getDateRangeForPreset('this-week')
                if (range) onRangeChange(range)
              }}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
