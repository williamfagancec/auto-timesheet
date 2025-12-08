import { trpc } from '../lib/trpc'
import { useNavigate, useLocation } from 'react-router-dom'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: authStatus } = trpc.auth.status.useQuery()

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      navigate('/login')
    },
  })

  const handleLogout = () => {
    logoutMutation.mutate()
  }

  // Get user initials for avatar
  const getUserInitials = (email: string) => {
    const parts = email.split('@')[0].split('.')
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    }
    return email.slice(0, 2).toUpperCase()
  }

  const isActive = (path: string) => {
    if (path === '/settings') {
      return location.pathname.startsWith('/settings')
    }
    return location.pathname === path
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sandy-light via-bg-secondary to-sandy-light">
      {/* Header Navigation with Glass Effect */}
      <header className="glass-effect sticky top-0 z-50 animate-fade-in-down">
        <div className="max-w-7xl mx-auto px-2xl">
          <div className="flex justify-between items-center h-16">
            {/* Logo & Navigation */}
            <div className="flex items-center gap-xl">
              {/* App Logo */}
              <div className="flex items-center gap-md animate-scale-in">
                <div className="w-14 h-14 flex items-center justify-center">
                  <img src="/logo.png" alt="TimeSync Logo" className="w-full h-full object-contain" />
                </div>
              </div>

              {/* Navigation */}
              <nav className="flex items-center gap-1">
                <button
                  onClick={() => navigate('/timesheet')}
                  className={`nav-item ${isActive('/timesheet') ? 'nav-item-active' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Timesheet
                </button>
                <button
                  onClick={() => navigate('/events')}
                  className={`nav-item ${isActive('/events') ? 'nav-item-active' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Events
                </button>
                <button
                  onClick={() => navigate('/projects')}
                  className={`nav-item ${isActive('/projects') ? 'nav-item-active' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Projects
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className={`nav-item ${isActive('/settings') ? 'nav-item-active' : ''}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              </nav>
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-md">
              {authStatus?.user && (
                <div className="flex items-center gap-md px-md py-sm rounded-lg hover:bg-gradient-mesh cursor-pointer transition-all duration-300 animate-fade-in">
                  <div className="w-9 h-9 rounded-full bg-gradient-primary text-white flex items-center justify-center text-sm font-medium shadow-md hover:shadow-glow transition-all duration-300 hover:scale-110">
                    {getUserInitials(authStatus.user.email)}
                  </div>
                  <span className="text-sm text-text-secondary hidden md:block">
                    {authStatus.user.email}
                  </span>
                </div>
              )}
              <button
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="btn-ghost text-sm"
              >
                {logoutMutation.isPending ? (
                  <><div className="spinner w-4 h-4" /> Logging out...</>
                ) : (
                  'Logout'
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content with animation */}
      <main className="max-w-7xl mx-auto px-2xl py-xl animate-fade-in-up">
        {children}
      </main>

      {/* Subtle background decoration */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-from-orange opacity-5 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-from-purple opacity-5 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '1s' }} />
      </div>
    </div>
  )
}
