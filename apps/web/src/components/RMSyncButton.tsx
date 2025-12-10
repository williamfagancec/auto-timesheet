import { useState, useEffect } from 'react'
import { format, endOfWeek } from 'date-fns'
import { trpc } from '../lib/trpc'
import type { AppRouter } from '../../../api/src/routers'
import { inferRouterOutputs } from '@trpc/server'

type RouterOutput = inferRouterOutputs<AppRouter>

interface RMSyncButtonProps {
  weekStart: Date
  onSyncComplete?: () => void
}

export function RMSyncButton({ weekStart, onSyncComplete }: RMSyncButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const fromDate = format(weekStart, 'yyyy-MM-dd')
  const toDate = format(weekEnd, 'yyyy-MM-dd')

  // Check if user has RM connection
  const { data: connection } = trpc.rm.connection.get.useQuery()

  useEffect(() => {
    if (connection) {
      console.log('[RMSyncButton] RM connection status:', connection ? 'Connected' : 'Not connected')
    }
  }, [connection])


  // Preview sync
  const { data: preview, isLoading: isLoadingPreview, error: previewError } = trpc.rm.sync.preview.useQuery(
    { fromDate, toDate },
    {
      enabled: showPreview,
    }
  )

  useEffect(() => {
    if (preview) {
      console.log('[RMSyncButton] Preview data received:', preview)
    }
  }, [preview])

  useEffect(() => {
    if (previewError) {
      console.error('[RMSyncButton] Preview error:', previewError)
    }
  }, [previewError])


  // Execute sync mutation
  const syncMutation = trpc.rm.sync.execute.useMutation({
    onSuccess: (result: RouterOutput['rm']['sync']['execute']) => {
      console.log('[RMSyncButton] Sync success:', result)
      // Success handling
      if (result.status === 'COMPLETED') {
        alert(`Successfully synced ${result.entriesSuccess} entries to RM!`)
      } else if (result.status === 'PARTIAL') {
        alert(
          `Partially synced: ${result.entriesSuccess} succeeded, ${result.entriesFailed} failed.\n\n` +
          `Errors:\n${result.errors.map((e) => `- ${e.error}`).join('\n')}`
        )
      } else {
        alert(`Sync failed: ${result.errors.map((e) => e.error).join(', ')}`)
      }

      setIsModalOpen(false)
      setShowPreview(false)
      onSyncComplete?.()
    },
    onError: (error) => {
      console.error('[RMSyncButton] Sync error:', error)
      alert(`Sync error: ${error.message}`)
    },
  })

  // Don't show button if no RM connection
  if (!connection) {
    return null
  }

  const handleOpenPreview = () => {
    console.log('[RMSyncButton] Opening preview modal', { fromDate, toDate })
    setIsModalOpen(true)
    setShowPreview(true)
  }

  const handleExecuteSync = () => {
    console.log('[RMSyncButton] Execute sync clicked', { fromDate, toDate })
    if (confirm('Sync this week to RM? This will create/update time entries in Resource Management.')) {
      console.log('[RMSyncButton] User confirmed, executing sync')
      syncMutation.mutate({ fromDate, toDate })
    } else {
      console.log('[RMSyncButton] User cancelled')
    }
  }

  return (
    <>
      <button
        onClick={handleOpenPreview}
        disabled={syncMutation.isPending}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {syncMutation.isPending ? 'Syncing...' : 'Sync to RM'}
      </button>

      {/* Preview Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Sync Preview</h2>

            {isLoadingPreview && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                <p className="mt-2 text-gray-600">Loading preview...</p>
              </div>
            )}

            {preview && (
              <>
                {/* Summary */}
                <div className="mb-6 p-4 bg-gray-50 rounded">
                  <h3 className="font-semibold mb-2">Summary</h3>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Total</p>
                      <p className="text-lg font-semibold">{preview.totalEntries}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">To Create</p>
                      <p className="text-lg font-semibold text-green-600">{preview.toCreate}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">To Update</p>
                      <p className="text-lg font-semibold text-blue-600">{preview.toUpdate}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">To Skip</p>
                      <p className="text-lg font-semibold text-gray-600">{preview.toSkip}</p>
                    </div>
                  </div>
                </div>

                {/* Unmapped Projects Warning */}
                {preview.unmappedProjects.length > 0 && (
                  <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
                    <h3 className="font-semibold text-yellow-800 mb-2">
                      ⚠️ Unmapped Projects
                    </h3>
                    <p className="text-sm text-yellow-700 mb-2">
                      These projects are not mapped to RM and will be skipped:
                    </p>
                    <ul className="text-sm text-yellow-700 list-disc list-inside">
                      {preview.unmappedProjects.map((p) => (
                        <li key={p.projectId}>{p.projectName}</li>
                      ))}
                    </ul>
                    <p className="text-sm text-yellow-700 mt-2">
                      <a href="/settings/rm/project-mapping" className="underline">
                        Map these projects
                      </a>{' '}
                      to include them in the sync.
                    </p>
                  </div>
                )}

                {/* Entries List */}
                {preview.entries.length > 0 && (
                  <div className="mb-6">
                    <h3 className="font-semibold mb-2">Entries ({preview.entries.length})</h3>
                    <div className="max-h-64 overflow-y-auto border rounded">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">Project</th>
                            <th className="px-3 py-2 text-right">Hours</th>
                            <th className="px-3 py-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.entries.map((entry, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="px-3 py-2">{entry.date}</td>
                              <td className="px-3 py-2">{entry.projectName}</td>
                              <td className="px-3 py-2 text-right">{entry.hours}h</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-block px-2 py-1 rounded text-xs ${
                                    entry.action === 'create'
                                      ? 'bg-green-100 text-green-800'
                                      : entry.action === 'update'
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {entry.action === 'create' && 'Create'}
                                  {entry.action === 'update' && 'Update'}
                                  {entry.action === 'skip' && `Skip: ${entry.reason}`}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsModalOpen(false)
                      setShowPreview(false)
                    }}
                    className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                    disabled={syncMutation.isPending}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecuteSync}
                    disabled={
                      syncMutation.isPending ||
                      preview.toCreate + preview.toUpdate === 0
                    }
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncMutation.isPending
                      ? 'Syncing...'
                      : `Sync ${preview.toCreate + preview.toUpdate} Entries`}
                  </button>
                </div>

                {/* Sync Progress */}
                {syncMutation.isPending && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
                    <div className="flex items-center gap-3">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      <p className="text-blue-800">
                        Syncing entries to RM... This may take a minute.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
