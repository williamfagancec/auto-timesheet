import { useState } from 'react'
import { trpc } from '../lib/trpc'
import { ProjectMappingRow } from '../components/ProjectMappingRow'

interface RMProject {
  id: number
  name: string
  code: string | null
  clientName?: string | null
}

export function RMProjectMapping() {
  const [searchFilter, setSearchFilter] = useState('')
  const [showAutoMapModal, setShowAutoMapModal] = useState(false)
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())

  const utils = trpc.useUtils()

  // Fetch user's projects
  const { data: projects = [], isLoading: projectsLoading } = trpc.project.list.useQuery(
    { includeArchived: false, sortBy: 'name' },
    { staleTime: 5 * 60 * 1000 }
  )

  // Fetch RM projects
  const {
    data: rmProjects = [],
    isLoading: rmProjectsLoading,
    error: rmProjectsError,
    refetch: refetchRMProjects,
  } = trpc.rm.projects.list.useQuery(undefined, { staleTime: 10 * 60 * 1000 })

  // Fetch current mappings
  const { data: mappings = [], isLoading: mappingsLoading } = trpc.rm.mappings.list.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  )

  // Fetch suggestions
  const { data: suggestions = [], isLoading: suggestionsLoading } =
    trpc.rm.mappings.suggestMatches.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
      enabled: rmProjects.length > 0 && projects.length > 0,
    })

  // Fetch high-confidence auto-map suggestions
  const { data: autoMapSuggestions = [] } = trpc.rm.mappings.getAutoMapSuggestions.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
      enabled: rmProjects.length > 0 && projects.length > 0,
    }
  )

  // Create mapping mutation
  const createMappingMutation = trpc.rm.mappings.create.useMutation({
    onSuccess: () => {
      utils.rm.mappings.list.invalidate()
      utils.rm.mappings.suggestMatches.invalidate()
      utils.rm.mappings.getAutoMapSuggestions.invalidate()
    },
    onError: (error) => {
      alert(`Failed to create mapping: ${error.message}`)
    },
  })

  // Delete mapping mutation
  const deleteMappingMutation = trpc.rm.mappings.delete.useMutation({
    onSuccess: () => {
      utils.rm.mappings.list.invalidate()
      utils.rm.mappings.suggestMatches.invalidate()
      utils.rm.mappings.getAutoMapSuggestions.invalidate()
    },
    onError: (error) => {
      alert(`Failed to delete mapping: ${error.message}`)
    },
  })

  // Bulk create mappings mutation
  const bulkCreateMutation = trpc.rm.mappings.createBulk.useMutation({
    onSuccess: (result) => {
      utils.rm.mappings.list.invalidate()
      utils.rm.mappings.suggestMatches.invalidate()
      utils.rm.mappings.getAutoMapSuggestions.invalidate()
      alert(`Successfully mapped ${result.created} project(s)`)
      setShowAutoMapModal(false)
      setSelectedSuggestions(new Set())
    },
    onError: (error) => {
      alert(`Failed to auto-map: ${error.message}`)
    },
  })

  // Handle creating a mapping
  const handleCreateMapping = async (projectId: string, rmProject: RMProject) => {
    await createMappingMutation.mutateAsync({
      projectId,
      rmProjectId: rmProject.id,
      rmProjectName: rmProject.name,
      rmProjectCode: rmProject.code || undefined,
    })
  }

  // Handle deleting a mapping
  const handleDeleteMapping = async (mappingId: string) => {
    if (confirm('Are you sure you want to remove this mapping?')) {
      await deleteMappingMutation.mutateAsync({ id: mappingId })
    }
  }

  // Handle auto-map with confirmation
  const handleAutoMap = () => {
    // Initialize with all suggestions selected
    const allSuggestionIds = new Set(autoMapSuggestions.map((s) => s.localProjectId))
    setSelectedSuggestions(allSuggestionIds)
    setShowAutoMapModal(true)
  }

  const handleConfirmAutoMap = async () => {
    const selectedMappings = autoMapSuggestions
      .filter((s) => selectedSuggestions.has(s.localProjectId))
      .map((s) => ({
        projectId: s.localProjectId,
        rmProjectId: s.rmProjectId,
        rmProjectName: s.rmProjectName,
        rmProjectCode: s.rmProjectCode || undefined,
      }))

    if (selectedMappings.length === 0) {
      alert('No mappings selected')
      return
    }

    await bulkCreateMutation.mutateAsync(selectedMappings)
  }

  const toggleSuggestion = (projectId: string) => {
    const newSelected = new Set(selectedSuggestions)
    if (newSelected.has(projectId)) {
      newSelected.delete(projectId)
    } else {
      newSelected.add(projectId)
    }
    setSelectedSuggestions(newSelected)
  }

  // Filter projects by search
  const filteredProjects = searchFilter
    ? projects.filter((p) => p.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : projects

  // Create suggestions map
  const suggestionsMap = new Map(suggestions.map((s) => [s.localProjectId, s]))

  // Create mappings map
  const mappingsMap = new Map(mappings.map((m) => [m.projectId, m]))

  // Loading state
  if (projectsLoading || rmProjectsLoading || mappingsLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">RM Project Mapping</h1>
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading...</div>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (rmProjectsError) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">RM Project Mapping</h1>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-red-800 font-semibold mb-2">Failed to load RM projects</h2>
            <p className="text-red-600 text-sm mb-4">{rmProjectsError.message}</p>
            <button
              onClick={() => refetchRMProjects()}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Empty state - no projects
  if (projects.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">RM Project Mapping</h1>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <p className="text-blue-800">
              You don't have any projects yet. Create some projects first to map them to RM.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Stats
  const mappedCount = mappings.length
  const unmappedCount = projects.length - mappedCount
  const highConfidenceCount = autoMapSuggestions.length

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">RM Project Mapping</h1>
          <p className="text-gray-600">
            Map your time-tracker projects to Resource Management projects for syncing
          </p>
        </div>

        {/* Stats & Actions */}
        <div className="bg-white border rounded-lg p-4 mb-6 flex items-center justify-between">
          <div className="flex gap-6">
            <div>
              <div className="text-sm text-gray-500">Mapped</div>
              <div className="text-2xl font-bold text-green-600">{mappedCount}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Unmapped</div>
              <div className="text-2xl font-bold text-gray-600">{unmappedCount}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">RM Projects</div>
              <div className="text-2xl font-bold text-blue-600">{rmProjects.length}</div>
            </div>
          </div>

          {highConfidenceCount > 0 && (
            <button
              onClick={handleAutoMap}
              disabled={bulkCreateMutation.isPending}
              className="
                px-4 py-2 bg-blue-600 text-white rounded-lg font-medium
                hover:bg-blue-700 transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              Auto-map {highConfidenceCount} suggestion{highConfidenceCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Search filter */}
        <div className="mb-4">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search projects..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* Mapping table */}
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Time-Tracker Project
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Mapped to RM Project
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Suggestion
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => (
                <ProjectMappingRow
                  key={project.id}
                  project={project}
                  currentMapping={mappingsMap.get(project.id)}
                  suggestion={suggestionsMap.get(project.id)}
                  rmProjects={rmProjects}
                  onMap={handleCreateMapping}
                  onUnmap={handleDeleteMapping}
                  isLoading={suggestionsLoading}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Auto-map confirmation modal */}
        {showAutoMapModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b">
                <h2 className="text-xl font-bold">Review Auto-Map Suggestions</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Uncheck any mappings you don't want to apply
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {autoMapSuggestions.map((suggestion) => {
                  const project = projects.find((p) => p.id === suggestion.localProjectId)
                  if (!project) return null

                  return (
                    <label
                      key={suggestion.localProjectId}
                      className="flex items-start gap-3 py-3 border-b cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSuggestions.has(suggestion.localProjectId)}
                        onChange={() => toggleSuggestion(suggestion.localProjectId)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{project.name}</span>
                          <span className="text-gray-400">→</span>
                          <span className="text-blue-600">{suggestion.rmProjectName}</span>
                          {suggestion.rmProjectCode && (
                            <span className="text-xs text-gray-500 font-mono">
                              {suggestion.rmProjectCode}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          Confidence: {(suggestion.score * 100).toFixed(0)}% ({suggestion.reason})
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>

              <div className="px-6 py-4 border-t flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {selectedSuggestions.size} of {autoMapSuggestions.length} selected
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowAutoMapModal(false)
                      setSelectedSuggestions(new Set())
                    }}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmAutoMap}
                    disabled={selectedSuggestions.size === 0 || bulkCreateMutation.isPending}
                    className="
                      px-4 py-2 bg-blue-600 text-white rounded
                      hover:bg-blue-700 transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed
                    "
                  >
                    {bulkCreateMutation.isPending
                      ? 'Mapping...'
                      : `Apply ${selectedSuggestions.size} mapping${
                          selectedSuggestions.size !== 1 ? 's' : ''
                        }`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
