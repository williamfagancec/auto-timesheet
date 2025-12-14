export function Test() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-500">
      <div className="bg-white p-8 rounded-lg shadow-xl">
        <h1 className="text-4xl font-bold text-green-600">✅ React App Is Working!</h1>
        <p className="mt-4 text-gray-700">If you can see this, React is rendering correctly.</p>
        <p className="mt-2 text-gray-700">The issue is likely with authentication/routing.</p>
        <div className="mt-6 space-y-2">
          <p className="text-sm text-gray-600">Timestamp: {new Date().toLocaleString()}</p>
          <button
            onClick={() => alert('JavaScript is working!')}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Test JavaScript
          </button>
        </div>
      </div>
    </div>
  )
}
