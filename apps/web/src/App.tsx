import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { trpc } from './lib/trpc'
import { useState } from 'react'
import { httpBatchLink } from '@trpc/client'

function App() {
  const [queryClient] = useState(() => new QueryClient())
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: 'http://localhost:3001/trpc',
          credentials: 'include',
        }),
      ],
    })
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="min-h-screen bg-background">
            <h1 className="text-4xl font-bold text-center p-8">
              Auto Timesheet
            </h1>
            <p className="text-center text-muted-foreground">
              Time tracking app - Basic structure ready
            </p>
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

export default App
