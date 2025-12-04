import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { format } from 'date-fns'
import { trpc } from '../lib/trpc'

export function Projects() {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [sortBy, setSortBy] = useState<'name' | 'lastUsedAt' | 'useCount' | 'hours30Days'>('lastUsedAt')
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
      <div className="max-w-6xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-orange mx-auto"></div>
          <p className="mt-lg text-text-secondary">Loading projects...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-xl">
        <h1 className="text-2xl font-semibold text-text-primary">Projects</h1>
        <p className="text-text-secondary mt-xs text-sm">Manage your project categories</p>
      </div>

      {/* Filters */}
      <div className="bg-white p-xl rounded-lg border border-border-light shadow-sm mb-xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-sm">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="input-primary"
            />
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-sm">Sort By</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="input-primary"
            >
              <option value="lastUsedAt">Last Used</option>
              <option value="name">Name (A-Z)</option>
              <option value="hours30Days">Most Hours (30 days)</option>
            </select>
          </div>

          {/* Show Archived */}
          <div className="flex items-end">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-accent-orange border-border-medium rounded focus:ring-accent-orange"
              />
              <span className="ml-sm text-sm text-text-primary">Show archived projects</span>
            </label>
          </div>
        </div>
      </div>

      {/* Projects Table */}
      {projects.length === 0 ? (
        <div className="bg-white p-2xl rounded-lg border border-border-light text-center">
          <p className="text-text-secondary">
            {search ? (
              <>
                No projects found matching "<strong>{search}</strong>"
              </>
            ) : showArchived ? (
              'No archived projects'
            ) : (
              <>
                No projects yet. Create your first project by categorizing an event on the{' '}
                <a href="/timesheet" className="text-accent-orange hover:text-accent-orange-hover font-medium">
                  Timesheet
                </a>{' '}
                page.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-border-light shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-border-light">
            <thead className="bg-sandy">
              <tr>
                <th className="px-xl py-md text-left text-xs font-medium text-text-primary uppercase tracking-wider">
                  Project Name
                </th>
                <th className="px-xl py-md text-left text-xs font-medium text-text-primary uppercase tracking-wider">
                  Last Used
                </th>
                <th className="px-xl py-md text-left text-xs font-medium text-text-primary uppercase tracking-wider">
                  Hours (30 days)
                </th>
                <th className="px-xl py-md text-left text-xs font-medium text-text-primary uppercase tracking-wider">
                  Status
                </th>
                <th className="px-xl py-md text-right text-xs font-medium text-text-primary uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border-light">
              {projects.map((project) => (
                <tr key={project.id} className={project.isArchived ? 'bg-bg-hover' : 'hover:bg-bg-hover transition-colors duration-150'}>
                  <td className="px-xl py-lg whitespace-nowrap">
                    {editingId === project.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, project.id)}
                        onBlur={() => handleSaveEdit(project.id)}
                        autoFocus
                        className="px-sm py-xs border border-border-medium rounded-md focus:outline-none focus:border-text-secondary"
                      />
                    ) : (
                      <div className="text-sm font-medium text-text-primary">{project.name}</div>
                    )}
                  </td>
                  <td className="px-xl py-lg whitespace-nowrap">
                    <div className="text-sm text-text-primary">
                      {format(new Date(project.lastUsedAt), 'MMM d, yyyy')}
                    </div>
                    <div className="text-xs text-text-tertiary">
                      {format(new Date(project.lastUsedAt), 'h:mm a')}
                    </div>
                  </td>
                  <td className="px-xl py-lg whitespace-nowrap">
                    <div className="text-sm text-text-primary">
                      {typeof (project as any).hours30Days === 'number'
                        ? (project as any).hours30Days.toFixed(1)
                        : '0.0'}
                    </div>
                  </td>
                  <td className="px-xl py-lg whitespace-nowrap">
                    {project.isArchived ? (
                      <span className="px-sm py-xs inline-flex text-xs leading-5 font-semibold rounded-md bg-bg-selected text-text-secondary">
                        Archived
                      </span>
                    ) : (
                      <span className="px-sm py-xs inline-flex text-xs leading-5 font-semibold rounded-md bg-green-100 text-green-800">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-xl py-lg whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleStartEdit(project.id, project.name)}
                      disabled={editingId !== null || project.isArchived}
                      className="text-accent-orange hover:text-accent-orange-hover mr-lg disabled:text-text-tertiary disabled:cursor-not-allowed"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleArchive(project.id, !project.isArchived)}
                      disabled={archiveMutation.isPending || editingId !== null}
                      className="text-text-secondary hover:text-text-primary disabled:text-text-tertiary disabled:cursor-not-allowed"
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
          <li>• Hours (30 days) shows total hours spent on this project in the past 30 days</li>
          <li>• Archived projects won't appear in the project picker</li>
          <li>• Click "Edit" to rename a project</li>
        </ul>
      </div>
    </div>
  )
}
