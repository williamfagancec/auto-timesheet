import { trpc } from '../lib/trpc'
import { useNavigate } from 'react-router-dom'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate()
  const { data: authStatus } = trpc.auth.status.useQuery()

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      navigate('/login')
    },
  })

  const handleLogout = () => {
    logoutMutation.mutate()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple header - easy to replace later */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-8">
              <h1 className="text-2xl font-bold text-gray-900">Auto Timesheet</h1>

              <nav className="flex space-x-4">
                <button
                  onClick={() => navigate('/timesheet')}
                  className="text-gray-700 hover:text-gray-900 px-3 py-2"
                >
                  Timesheet
                </button>
                <button
                  onClick={() => navigate('/events')}
                  className="text-gray-700 hover:text-gray-900 px-3 py-2"
                >
                  Events
                </button>
                <button
                  onClick={() => navigate('/projects')}
                  className="text-gray-700 hover:text-gray-900 px-3 py-2"
                >
                  Projects
                </button>
              </nav>
            </div>

            <div className="flex items-center space-x-4">
              {authStatus?.user && (
                <span className="text-sm text-gray-600">
                  {authStatus.user.email}
                </span>
              )}
              <button
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300 disabled:bg-gray-100"
              >
                {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
