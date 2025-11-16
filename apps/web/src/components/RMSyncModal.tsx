import { useState } from 'react';
import { trpc } from '../lib/trpc';

interface RMSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  weekStartDate: string;
  unmappedProjects?: Array<{ id: string; name: string }>;
}

export function RMSyncModal({
  isOpen,
  onClose,
  weekStartDate,
  unmappedProjects = [],
}: RMSyncModalProps) {
  const [syncStarted, setSyncStarted] = useState(false);

  const syncMutation = trpc.rm.sync.execute.useMutation({
    onSuccess: () => {
      // Keep modal open to show results
    },
    onError: (error) => {
      console.error('Sync failed:', error);
    },
  });

  if (!isOpen) return null;

  const handleConfirmSync = () => {
    setSyncStarted(true);
    syncMutation.mutate({ weekStartDate });
  };

  const handleClose = () => {
    setSyncStarted(false);
    syncMutation.reset();
    onClose();
  };

  const hasUnmappedProjects = unmappedProjects.length > 0;
  const showResults = syncMutation.isSuccess;
  const showError = syncMutation.isError;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Sync to Resource Management
          </h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {/* Pre-sync warnings */}
          {!syncStarted && hasUnmappedProjects && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">
                ⚠️ Warning: Unmapped Projects
              </h3>
              <p className="text-sm text-yellow-700 mb-2">
                The following projects will be skipped because they are not mapped to RM:
              </p>
              <ul className="list-disc list-inside text-sm text-yellow-700">
                {unmappedProjects.map((p) => (
                  <li key={p.id}>{p.name}</li>
                ))}
              </ul>
              <p className="text-sm text-yellow-700 mt-2">
                You can map these projects on the Projects page before syncing.
              </p>
            </div>
          )}

          {/* Loading spinner */}
          {syncMutation.isPending && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
              <p className="mt-4 text-gray-600">Syncing timesheet entries to RM...</p>
              <p className="mt-2 text-sm text-gray-500">This may take a moment</p>
            </div>
          )}

          {/* Success results */}
          {showResults && (
            <div>
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <h3 className="text-sm font-medium text-green-800">✓ Sync Complete</h3>
                <p className="text-sm text-green-700 mt-1">
                  {syncMutation.data.entriesSuccess} of {syncMutation.data.entriesAttempted} entries
                  synced successfully
                  {syncMutation.data.entriesSkipped > 0 &&
                    ` (${syncMutation.data.entriesSkipped} unchanged entries skipped)`}
                </p>
              </div>

              {/* Statistics */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 bg-gray-50 rounded-md">
                  <div className="text-2xl font-semibold text-gray-900">
                    {syncMutation.data.entriesSuccess}
                  </div>
                  <div className="text-sm text-gray-600">Synced</div>
                </div>
                <div className="p-3 bg-gray-50 rounded-md">
                  <div className="text-2xl font-semibold text-gray-900">
                    {syncMutation.data.entriesSkipped}
                  </div>
                  <div className="text-sm text-gray-600">Skipped (unchanged)</div>
                </div>
                {syncMutation.data.entriesFailed > 0 && (
                  <div className="p-3 bg-red-50 rounded-md col-span-2">
                    <div className="text-2xl font-semibold text-red-900">
                      {syncMutation.data.entriesFailed}
                    </div>
                    <div className="text-sm text-red-600">Failed</div>
                  </div>
                )}
              </div>

              {/* Unmapped projects in result */}
              {syncMutation.data.unmappedProjects.length > 0 && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                  <h3 className="text-sm font-medium text-yellow-800 mb-2">
                    Skipped Unmapped Projects ({syncMutation.data.unmappedProjects.length})
                  </h3>
                  <ul className="list-disc list-inside text-sm text-yellow-700">
                    {syncMutation.data.unmappedProjects.map((p) => (
                      <li key={p.id}>{p.name}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Errors */}
              {syncMutation.data.errors.length > 0 && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <h3 className="text-sm font-medium text-red-800 mb-2">
                    Errors ({syncMutation.data.errors.length})
                  </h3>
                  <ul className="text-sm text-red-700 space-y-1 max-h-48 overflow-y-auto">
                    {syncMutation.data.errors.slice(0, 10).map((err, idx) => (
                      <li key={idx} className="font-mono text-xs">
                        Entry {err.entryId.substring(0, 8)}...: {err.error}
                      </li>
                    ))}
                    {syncMutation.data.errors.length > 10 && (
                      <li className="text-red-600 font-medium">
                        ... and {syncMutation.data.errors.length - 10} more errors
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Error state */}
          {showError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <h3 className="text-sm font-medium text-red-800">✗ Sync Failed</h3>
              <p className="text-sm text-red-700 mt-1">{syncMutation.error.message}</p>
              {syncMutation.error.message.includes('reconnect') && (
                <p className="text-sm text-red-600 mt-2">
                  Please go to Settings and reconnect your RM account.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          {!syncStarted && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSync}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Sync to RM
              </button>
            </>
          )}

          {(showResults || showError) && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
