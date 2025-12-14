import { Navigate, useLocation } from 'react-router-dom'
import { trpc } from '../lib/trpc'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const location = useLocation()
  const { data: authStatus, isLoading, error } = trpc.auth.status.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
  })

  console.log('[ProtectedRoute]', { isLoading, authenticated: authStatus?.authenticated, error })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (error) {
    console.error('[ProtectedRoute] Error checking auth status:', error)
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (!authStatus?.authenticated) {
    console.log('[ProtectedRoute] Not authenticated, redirecting to login')
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  console.log('[ProtectedRoute] Authenticated, rendering children')
  return <>{children}</>
}
