import { useState } from 'react'
import { Command } from 'cmdk'

interface RMProject {
  id: number
  name: string
  code: string | null
  clientName?: string | null
}

interface RMProjectSelectorProps {
  rmProjects: RMProject[]
  value?: number | null
  onSelect: (project: RMProject) => void
  placeholder?: string
  disabled?: boolean
}

export function RMProjectSelector({
  rmProjects,
  value,
  onSelect,
  placeholder = 'Select RM project...',
  disabled = false,
}: RMProjectSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Get selected project for display
  const selectedProject = value
    ? rmProjects.find((p) => p.id === value)
    : null

  // Filter projects by search
  const filteredProjects = search
    ? rmProjects.filter((p) => {
        const searchLower = search.toLowerCase()
        return (
          p.name.toLowerCase().includes(searchLower) ||
          p.code?.toLowerCase().includes(searchLower) ||
          p.clientName?.toLowerCase().includes(searchLower)
        )
      })
    : rmProjects

  // Sort: exact name match first, then alphabetical
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (search) {
      const searchLower = search.toLowerCase()
      const aExact = a.name.toLowerCase() === searchLower
      const bExact = b.name.toLowerCase() === searchLower
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      const aStarts = a.name.toLowerCase().startsWith(searchLower)
      const bStarts = b.name.toLowerCase().startsWith(searchLower)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
    }
    return a.name.localeCompare(b.name)
  })

  const handleSelect = (project: RMProject) => {
    onSelect(project)
    setOpen(false)
    setSearch('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd+K or Ctrl+K to open
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      if (!disabled) {
        setOpen(true)
      }
    }

    // Escape to close
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
    }
  }

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`
          w-full px-3 py-2 text-left border rounded-md
          ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white hover:border-blue-400'}
          ${open ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'}
          focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200
          transition-colors
        `}
      >
        {selectedProject ? (
          <span className="flex items-center justify-between">
            <span className="truncate">{selectedProject.name}</span>
            {selectedProject.code && (
              <span className="ml-2 text-xs text-gray-500 font-mono">
                {selectedProject.code}
              </span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && !disabled && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false)
              setSearch('')
            }}
          />

          {/* Command palette */}
          <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-80">
            <Command shouldFilter={false}>
              {/* Search input */}
              <div className="border-b border-gray-200 px-3 py-2">
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search projects..."
                  className="w-full outline-none text-sm"
                  autoFocus
                />
              </div>

              {/* Results list */}
              <Command.List className="max-h-64 overflow-y-auto p-1">
                {sortedProjects.length === 0 && (
                  <div className="px-3 py-4 text-sm text-gray-500 text-center">
                    No projects found
                  </div>
                )}

                {sortedProjects.map((project) => (
                  <Command.Item
                    key={project.id}
                    value={String(project.id)}
                    onSelect={() => handleSelect(project)}
                    className="
                      px-3 py-2 cursor-pointer rounded
                      hover:bg-blue-50
                      data-[selected=true]:bg-blue-100
                      flex items-center justify-between
                    "
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {project.name}
                      </div>
                      {project.clientName && (
                        <div className="text-xs text-gray-500 truncate">
                          {project.clientName}
                        </div>
                      )}
                    </div>
                    {project.code && (
                      <div className="ml-3 text-xs text-gray-500 font-mono flex-shrink-0">
                        {project.code}
                      </div>
                    )}
                  </Command.Item>
                ))}
              </Command.List>

              {/* Footer hint */}
              {rmProjects.length > 0 && (
                <div className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
                  {sortedProjects.length} of {rmProjects.length} projects
                </div>
              )}
            </Command>
          </div>
        </>
      )}
    </div>
  )
}
