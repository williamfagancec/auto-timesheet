import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { trpc } from './lib/trpc'
import { useState, useEffect } from 'react'
import { httpBatchLink, TRPCClientError } from '@trpc/client'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { AuthCallback } from './pages/AuthCallback'
import { Events } from './pages/Events'
import { Timesheet } from './pages/Timesheet'
import { Projects } from './pages/Projects'
import { Settings } from './pages/Settings'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

// Global error handler for session invalidation
let sessionInvalidatedCallback: (() => void) | null = null

function App() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Don't retry on session invalidation errors
          if (error instanceof TRPCClientError) {
            if (error.message.includes('SESSION_INVALIDATED')) {
              return false
            }
          }
          return failureCount < 3
        },
      },
      mutations: {
        retry: false,
        onError: (error) => {
          // Check for session invalidation errors
          if (error instanceof TRPCClientError) {
            if (error.message.includes('SESSION_INVALIDATED')) {
              // Clear all queries
              queryClient.clear()
              // Call the callback to redirect to login
              if (sessionInvalidatedCallback) {
                sessionInvalidatedCallback()
              }
            }
          }
        },
      },
    },
  }))

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          // Use relative URL to leverage Vite proxy - avoids cross-origin cookie issues
          url: '/trpc',
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionInvalidationHandler />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            <Route
              path="/events"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Events />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/timesheet"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Timesheet />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/projects"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Projects />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Settings />
                  </Layout>
                </ProtectedRoute>
              }
            />

            <Route path="/" element={<Navigate to="/timesheet" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

// Component to handle session invalidation redirects
function SessionInvalidationHandler() {
  const navigate = useNavigate()

  useEffect(() => {
    // Set up the global callback
    sessionInvalidatedCallback = () => {
      console.log('[Session] Session invalidated - redirecting to login')
      // Show alert to user
      alert('Your session has expired. Please log in again to continue.')
      // Redirect to login
      navigate('/login', { replace: true })
    }

    // Cleanup
    return () => {
      sessionInvalidatedCallback = null
    }
  }, [navigate])

  return null
}

export default App
