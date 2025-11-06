import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { format } from 'date-fns'
import { trpc } from '../lib/trpc'

export function Projects() {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'lastUsedAt' | 'useCount'>('lastUsedAt')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  // Fetch projects with current filters
  const {
    data: projects = [],
    isLoading,
    refetch,
  } = trpc.project.list.useQuery(
    {
      search: search || undefined,
      sortBy,
      includeArchived: showArchived,
    },
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  )

  // Archive/unarchive mutation
  const archiveMutation = trpc.project.archive.useMutation({
    onSuccess: () => {
      refetch()
    },
  })

  // Update project name mutation
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      setEditingName('')
      refetch()
    },
  })

  const handleArchive = (id: string, isArchived: boolean) => {
    if (
      !isArchived &&
      !confirm(
        'Are you sure you want to archive this project? It will no longer appear in the project picker.'
      )
    ) {
      return
    }

    archiveMutation.mutate({ id, isArchived })
  }

  const handleStartEdit = (id: string, name: string) => {
    setEditingId(id)
    setEditingName(name)
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleSaveEdit = (id: string) => {
    if (!editingName.trim()) {
      alert('Project name cannot be empty')
      return
    }

    updateMutation.mutate({ id, name: editingName })
  }

  const handleKeyDown = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleSaveEdit(id)
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading projects...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
        <p className="text-gray-600 mt-2">Manage your project categories</p>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg border mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="lastUsedAt">Last Used</option>
              <option value="name">Name (A-Z)</option>
              <option value="useCount">Most Used</option>
            </select>
          </div>

          {/* Show Archived */}
          <div className="flex items-end">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm text-gray-700">Show archived projects</span>
            </label>
          </div>
        </div>
      </div>

      {/* Projects Table */}
      {projects.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border text-center">
          <p className="text-gray-500">
            {search ? (
              <>
                No projects found matching "<strong>{search}</strong>"
              </>
            ) : showArchived ? (
              'No archived projects'
            ) : (
              <>
                No projects yet. Create your first project by categorizing an event on the{' '}
                <a href="/timesheet" className="text-blue-600 hover:text-blue-700 font-medium">
                  Timesheet
                </a>{' '}
                page.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Project Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Used
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Use Count
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {projects.map((project) => (
                <tr key={project.id} className={project.isArchived ? 'bg-gray-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {editingId === project.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, project.id)}
                        onBlur={() => handleSaveEdit(project.id)}
                        autoFocus
                        className="px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <div className="text-sm font-medium text-gray-900">{project.name}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {format(new Date(project.lastUsedAt), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {format(new Date(project.lastUsedAt), 'h:mm a')}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{project.useCount}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {project.isArchived ? (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        Archived
                      </span>
                    ) : (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleStartEdit(project.id, project.name)}
                      disabled={editingId !== null || project.isArchived}
                      className="text-blue-600 hover:text-blue-900 mr-4 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleArchive(project.id, !project.isArchived)}
                      disabled={archiveMutation.isPending || editingId !== null}
                      className="text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      {project.isArchived ? 'Unarchive' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Error Messages */}
      {archiveMutation.isError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{archiveMutation.error.message}</p>
        </div>
      )}
      {updateMutation.isError && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-600">{updateMutation.error.message}</p>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-sm font-medium text-blue-900 mb-2">Tips</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Projects are created automatically when you categorize events</li>
          <li>• Use Count shows how many times you've used this project</li>
          <li>• Archived projects won't appear in the project picker</li>
          <li>• Click "Edit" to rename a project</li>
        </ul>
      </div>
    </div>
  )
}
