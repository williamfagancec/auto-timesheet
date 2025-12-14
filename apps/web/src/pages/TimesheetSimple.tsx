export function TimesheetSimple() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
      <div className="bg-white p-12 rounded-xl shadow-2xl max-w-2xl">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          ✅ Timesheet Page Loaded!
        </h1>
        <p className="text-lg text-gray-700 mb-2">
          If you can see this, the timesheet route is working.
        </p>
        <p className="text-gray-600">
          This is a simplified version without the full TimesheetGrid component.
        </p>
        <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> The actual timesheet grid has been temporarily replaced
            with this simple page for debugging.
          </p>
        </div>
      </div>
    </div>
  )
}
