import { useState } from 'react'
import { RMProjectSelector } from './RMProjectSelector'

interface RMProject {
  id: number
  name: string
  code: string | null
  clientName?: string | null
}

interface ProjectMapping {
  id: string
  projectId: string
  rmProjectId: number
  rmProjectName: string
  rmProjectCode: string | null
}

interface MatchSuggestion {
  localProjectId: string
  rmProjectId: number
  rmProjectName: string
  rmProjectCode: string | null
  score: number
  reason: string
}

interface ProjectMappingRowProps {
  project: {
    id: string
    name: string
  }
  currentMapping?: ProjectMapping | null
  suggestion?: MatchSuggestion | null
  rmProjects: RMProject[]
  onMap: (projectId: string, rmProject: RMProject) => Promise<void>
  onUnmap: (mappingId: string) => Promise<void>
  isLoading?: boolean
}

export function ProjectMappingRow({
  project,
  currentMapping,
  suggestion,
  rmProjects,
  onMap,
  onUnmap,
  isLoading = false,
}: ProjectMappingRowProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleMap = async (rmProject: RMProject) => {
    setIsSubmitting(true)
    try {
      await onMap(project.id, rmProject)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUnmap = async () => {
    if (!currentMapping) return
    setIsSubmitting(true)
    try {
      await onUnmap(currentMapping.id)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUseSuggestion = async () => {
    if (!suggestion) return
    const rmProject = rmProjects.find((p) => p.id === suggestion.rmProjectId)
    if (rmProject) {
      await handleMap(rmProject)
    }
  }

  // Get confidence badge styling
  const getConfidenceBadge = (score: number) => {
    if (score >= 0.95) {
      return { text: 'Exact', className: 'bg-green-100 text-green-800' }
    } else if (score >= 0.85) {
      return { text: 'High', className: 'bg-green-100 text-green-700' }
    } else if (score >= 0.75) {
      return { text: 'Good', className: 'bg-yellow-100 text-yellow-800' }
    } else {
      return { text: 'Low', className: 'bg-gray-100 text-gray-600' }
    }
  }

  return (
    <tr className={`border-b ${isLoading ? 'opacity-50' : ''}`}>
      {/* Local Project Name */}
      <td className="px-4 py-3">
        <div className="font-medium text-sm">{project.name}</div>
      </td>

      {/* Mapped RM Project or Selector */}
      <td className="px-4 py-3">
        {currentMapping ? (
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-green-600">✓</span>
                <span className="font-medium text-sm">{currentMapping.rmProjectName}</span>
                {currentMapping.rmProjectCode && (
                  <span className="text-xs text-gray-500 font-mono">
                    {currentMapping.rmProjectCode}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-sm">
            <RMProjectSelector
              rmProjects={rmProjects}
              value={null}
              onSelect={handleMap}
              placeholder="Select RM project..."
              disabled={isSubmitting || isLoading}
            />
          </div>
        )}
      </td>

      {/* Suggestion */}
      <td className="px-4 py-3">
        {suggestion && !currentMapping && (
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 text-xs rounded ${
                getConfidenceBadge(suggestion.score).className
              }`}
            >
              {getConfidenceBadge(suggestion.score).text}
            </span>
            <div className="text-sm text-gray-600">
              <span className="font-medium">{suggestion.rmProjectName}</span>
              {suggestion.rmProjectCode && (
                <span className="ml-1 text-xs font-mono text-gray-500">
                  ({suggestion.rmProjectCode})
                </span>
              )}
            </div>
          </div>
        )}
        {currentMapping && (
          <span className="text-xs text-gray-500">Mapped</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {suggestion && !currentMapping && (
            <button
              onClick={handleUseSuggestion}
              disabled={isSubmitting || isLoading}
              className="
                px-3 py-1 text-sm font-medium text-blue-600
                hover:bg-blue-50 rounded transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              Use suggestion
            </button>
          )}
          {currentMapping && (
            <button
              onClick={handleUnmap}
              disabled={isSubmitting || isLoading}
              className="
                px-3 py-1 text-sm font-medium text-red-600
                hover:bg-red-50 rounded transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {isSubmitting ? 'Removing...' : 'Remove'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
