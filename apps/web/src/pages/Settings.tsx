import { useState } from 'react'
import { trpc } from '../lib/trpc'

export function Settings() {
  const [apiToken, setApiToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [rmUserId, setRmUserId] = useState('')

  // Fetch current user info
  const { data: authStatus } = trpc.auth.status.useQuery()

  // Fetch current RM connection
  const {
    data: connection,
    isLoading,
    refetch,
  } = trpc.rm.connection.get.useQuery()

  // Create connection mutation
  const createMutation = trpc.rm.connection.create.useMutation({
    onSuccess: () => {
      setApiToken('')
      setShowToken(false)
      refetch()
    },
    onError: (error) => {
      alert(`Failed to connect: ${error.message}`)
    },
  })

  // Delete connection mutation
  const deleteMutation = trpc.rm.connection.delete.useMutation({
    onSuccess: () => {
      refetch()
    },
    onError: (error) => {
      alert(`Failed to disconnect: ${error.message}`)
    },
  })

  // Update RM user ID mutation
  const updateRmUserIdMutation = trpc.auth.updateRMUserId.useMutation({
    onSuccess: () => {
      alert('RM user ID updated successfully!')
      setRmUserId('')
    },
    onError: (error) => {
      alert(`Failed to update RM user ID: ${error.message}`)
    },
  })

  const handleConnect = () => {
    if (!apiToken.trim()) {
      alert('Please enter your RM API token')
      return
    }

    createMutation.mutate({ apiToken })
  }

  const handleDisconnect = () => {
    if (
      !confirm(
        'Are you sure you want to disconnect from RM? This will delete all project mappings and sync history.'
      )
    ) {
      return
    }

    deleteMutation.mutate()
  }

  const handleUpdateRmUserId = () => {
    const userId = parseInt(rmUserId.trim())
    if (!rmUserId.trim() || isNaN(userId) || userId <= 0) {
      alert('Please enter a valid RM user ID (positive number)')
      return
    }

    updateRmUserIdMutation.mutate({ rmUserId: userId })
  }

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-orange mx-auto"></div>
          <p className="mt-lg text-text-secondary">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-xl">
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="mt-xs text-sm text-text-secondary">Manage your integrations and preferences</p>
      </div>

      {/* User Settings Section */}
      <div className="bg-white rounded-lg border border-border-light shadow-sm overflow-hidden mb-6">
        <div className="bg-sandy px-xl py-lg border-b border-border-light">
          <h2 className="text-xl font-semibold text-text-primary">
            Your Profile
          </h2>
          <p className="mt-xs text-sm text-text-secondary">
            Configure your personal information for RM sync
          </p>
        </div>
        <div className="p-xl">
          <div className="space-y-4">
            {authStatus?.user?.rmUserId && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800">
                  <span className="font-medium">Current RM User ID:</span> {authStatus.user.rmUserId}
                </p>
                <p className="text-xs text-green-700 mt-1">
                  Time entries will be synced to this RM user
                </p>
              </div>
            )}

            <div>
              <label
                htmlFor="rm-user-id"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                RM User ID
              </label>
              <p className="text-xs text-gray-600 mb-2">
                This is your user ID in Resource Management. Find it by going to Settings → My Profile in RM.
              </p>
              <div className="flex gap-3">
                <input
                  id="rm-user-id"
                  type="number"
                  value={rmUserId}
                  onChange={(e) => setRmUserId(e.target.value)}
                  placeholder={authStatus?.user?.rmUserId?.toString() || "Enter your RM user ID"}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={updateRmUserIdMutation.isPending}
                />
                <button
                  onClick={handleUpdateRmUserId}
                  disabled={updateRmUserIdMutation.isPending || !rmUserId.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updateRmUserIdMutation.isPending ? 'Updating...' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RM Integration Section */}
      <div className="bg-white rounded-lg border border-border-light shadow-sm overflow-hidden">
        <div className="bg-sandy px-xl py-lg border-b border-border-light">
          <h2 className="text-xl font-semibold text-text-primary">
            RM Integration
          </h2>
          <p className="mt-xs text-sm text-text-secondary">
            Connect to Resource Management by Smartsheet to sync your timesheet entries
          </p>
        </div>
        <div className="p-xl">

        {connection ? (
          /* Connected State */
          <div className="space-y-4">
            <div className="flex items-start justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <svg
                    className="w-5 h-5 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="font-medium text-green-900">
                    Connected to RM
                  </span>
                </div>
                <div className="text-sm text-green-800 space-y-1">
                  <p>
                    <span className="font-medium">User:</span> {connection.rmUserEmail}
                    {connection.rmUserName && ` (${connection.rmUserName})`}
                  </p>
                  {connection.lastSyncAt && (
                    <p>
                      <span className="font-medium">Last synced:</span>{' '}
                      {new Date(connection.lastSyncAt).toLocaleString()}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Connected since:</span>{' '}
                    {new Date(connection.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => window.location.href = '/settings/rm/project-mapping'}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                Manage Project Mappings
              </button>
              <button
                onClick={handleDisconnect}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          /* Not Connected State */
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm text-gray-700 mb-3">
                To connect your RM account, you'll need an API token from Resource Management.
              </p>
              <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                <li>
                  Log in to{' '}
                  <a
                    href="https://app.rm.smartsheet.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Resource Management
                  </a>
                </li>
                <li>Go to Settings → Developer API</li>
                <li>Generate or copy your API token</li>
                <li>Paste the token below and click Connect</li>
              </ol>
            </div>

            <div>
              <label
                htmlFor="rm-token"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                RM API Token
              </label>
              <div className="relative">
                <input
                  id="rm-token"
                  type={showToken ? 'text' : 'password'}
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="Enter your RM API token"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-24"
                  disabled={createMutation.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 text-sm text-gray-600 hover:text-gray-900"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConnect}
                disabled={createMutation.isPending || !apiToken.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? 'Connecting...' : 'Connect to RM'}
              </button>
              <a
                href="https://help.smartsheet.com/articles/2482468-resource-management-api"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-gray-700 hover:text-gray-900 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Help
              </a>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
