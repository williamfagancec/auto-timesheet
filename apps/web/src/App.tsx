import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { trpc } from './lib/trpc'
import { httpBatchLink } from '@trpc/client'

// Import pages
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { AuthCallback } from './pages/AuthCallback'
import { Test } from './pages/Test'
import { Debug } from './pages/Debug'
import { Events } from './pages/Events'
import { Timesheet } from './pages/Timesheet'

import { Projects } from './pages/Projects'
import { Settings } from './pages/Settings'
import { RMProjectMapping } from './pages/RMProjectMapping'
import { NotFound } from './pages/NotFound'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

function App() {
  console.log('[App] Rendering App component')

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 5 * 60 * 1000,
      },
    },
  }))

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: import.meta.env.VITE_API_URL
            ? `${import.meta.env.VITE_API_URL}/trpc`
            : '/trpc',
          fetch(url, options) {
            return fetch(url, {
              ...options,
              credentials: 'include',
            })
          },
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/test" element={<Test />} />
            <Route path="/debug" element={<Debug />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Protected routes */}
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

            {/* Redirect /timesheets (plural) to /timesheet (singular) */}
            <Route path="/timesheets" element={<Navigate to="/timesheet" replace />} />

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

            <Route
              path="/settings/rm/project-mapping"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RMProjectMapping />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* 404 catch-all route */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

export default App
