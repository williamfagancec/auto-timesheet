import { useState, useEffect, useRef } from 'react'
import { Command } from 'cmdk'
import { trpc } from '../lib/trpc'

interface Project {
  id: string
  name: string
  useCount: number
  lastUsedAt: Date
  isArchived: boolean
}

interface ProjectPickerProps {
  onSelect: (projectId: string) => void
  onCreateNew?: (name: string) => void
  value?: string
  placeholder?: string
  disabled?: boolean
}

export function ProjectPicker({
  onSelect,
  onCreateNew,
  value,
  placeholder = 'Select or create project...',
  disabled = false,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom')
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils()

  // Fetch recent projects (last 10 used)
  const { data: recentProjects = [] } = trpc.project.list.useQuery(
    { sortBy: 'lastUsedAt', limit: 10 },
    {
      staleTime: 5 * 60 * 1000, // 5 minutes
      enabled: open,
    }
  )

  // Fetch all projects filtered by search
  const { data: allProjects = [] } = trpc.project.list.useQuery(
    { search: search || undefined, sortBy: 'name' },
    {
      staleTime: 5 * 60 * 1000,
      enabled: open && search.length > 0,
    }
  )

  // Get AI suggestions (stub - returns empty array for SCL)
  const { data: suggestions = [] } = trpc.project.getSuggestions.useQuery(
    {
      eventTitle: '',
      attendees: [],
    },
    {
      staleTime: 5 * 60 * 1000,
      enabled: false, // Disabled for SCL - no suggestions yet
    }
  )

  // Increment project use count on selection
  const incrementUseMutation = trpc.project.incrementUse.useMutation()

  // Create new project
  const createProjectMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      // Invalidate all project.list queries to refresh the cache
      utils.project.list.invalidate()
      onSelect(project.id)
      setOpen(false)
      setSearch('')
    },
  })

  // Get selected project name for display
  const { data: selectedProject } = trpc.project.list.useQuery(
    { sortBy: 'name' },
    {
      staleTime: 5 * 60 * 1000,
      enabled: Boolean(value),
      select: (projects) => projects.find((p) => p.id === value),
    }
  )

  const handleSelect = (projectId: string) => {
    onSelect(projectId)
    // Increment use count in background (don't wait)
    incrementUseMutation.mutate({ id: projectId })
    setOpen(false)
    setSearch('')
  }

  const handleCreateNew = () => {
    if (!search.trim()) return

    if (onCreateNew) {
      onCreateNew(search)
      setOpen(false)
      setSearch('')
    } else {
      createProjectMutation.mutate({ name: search })
    }
  }

  // Check if search matches an existing project exactly
  const hasExactMatch = allProjects.some(
    (p) => p.name.toLowerCase() === search.toLowerCase()
  )

  // Combine and dedupe projects
  const recentProjectIds = new Set(recentProjects.map((p) => p.id))
  const filteredAllProjects = allProjects.filter((p) => !recentProjectIds.has(p.id))

  // Keyboard shortcut to open picker
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const DROPDOWN_MAX_HEIGHT = 300;
  const DROPDOWN_PADDING = 50; // Account for padding/borders
  // Calculate dropdown position when opening
  useEffect(() => {
    if (open && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = DROPDOWN_MAX_HEIGHT + DROPDOWN_PADDING
      const spaceBelow = window.innerHeight - buttonRect.bottom
      const spaceAbove = buttonRect.top

      // If not enough space below but enough space above, show dropdown above
      if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
        setDropdownPosition('top')
      } else {
        setDropdownPosition('bottom')
      }
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="w-full px-4 py-2 text-left bg-white border rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
      >
        {selectedProject ? (
          <span className="text-gray-900">{selectedProject.name}</span>
        ) : (
          <span className="text-gray-500">{placeholder}</span>
        )}
        <svg
          className={`w-4 h-4 ml-2 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-50 w-full bg-white border rounded-lg shadow-lg ${
          dropdownPosition === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
        }`}>
          <Command className="rounded-lg border-none" shouldFilter={false}>
            <div className="border-b px-3 py-2">
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search or create new..."
                className="w-full outline-none text-sm"
                autoFocus
              />
            </div>

            <Command.List className="max-h-[300px] overflow-y-auto py-2">
              <Command.Empty className="py-6 text-center text-sm text-gray-500">
                {search ? (
                  <div>
                    <p className="mb-2">No projects found</p>
                    <button
                      onClick={handleCreateNew}
                      className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                      + Create "{search}"
                    </button>
                  </div>
                ) : (
                  'No projects yet. Start typing to create one!'
                )}
              </Command.Empty>

              {/* AI Suggestions Section (empty for SCL) */}
              {suggestions.length > 0 && (
                <Command.Group heading="Suggested">
                  {suggestions.map((project: Project) => (
                    <Command.Item
                      key={project.id}
                      value={project.name}
                      onSelect={() => handleSelect(project.id)}
                      className="flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 data-[selected=true]:bg-gray-100"
                    >
                      <span className="mr-2">✨</span>
                      <span>{project.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Recent Projects Section */}
              {recentProjects.length > 0 && (
                <Command.Group>
                  {recentProjects.map((project) => (
                    <Command.Item
                      key={project.id}
                      value={project.name}
                      onSelect={() => handleSelect(project.id)}
                      className="flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 data-[selected=true]:bg-gray-100"
                    >
                      <span>{project.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* All Projects Section */}
              {filteredAllProjects.length > 0 && (
                <Command.Group heading="All Projects">
                  {filteredAllProjects.map((project) => (
                    <Command.Item
                      key={project.id}
                      value={project.name}
                      onSelect={() => handleSelect(project.id)}
                      className="flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 data-[selected=true]:bg-gray-100"
                    >
                      <span>{project.name}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* Create New Option */}
              {search && !hasExactMatch && (
                <Command.Group>
                  <Command.Item
                    value={`create-new-${search}`}
                    onSelect={handleCreateNew}
                    className="flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 data-[selected=true]:bg-blue-50 text-blue-600 font-medium"
                  >
                    <span className="mr-2">+</span>
                    <span>Create "{search}"</span>
                  </Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>

          {/* Loading/Error States */}
          {createProjectMutation.isPending && (
            <div className="px-3 py-2 text-sm text-gray-500 border-t">
              Creating project...
            </div>
          )}
          {createProjectMutation.isError && (
            <div className="px-3 py-2 text-sm text-red-600 border-t">
              {createProjectMutation.error.message}
            </div>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={(e) => {
            // Prevent closing if clicking on the button itself
            if ((e.target as HTMLElement).closest('button'))  return
            setOpen(false)
            setSearch('')
          }}
        />
      )}
    </div>
  )}