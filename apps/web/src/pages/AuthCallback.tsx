import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { trpc } from '../lib/trpc'

export function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  const googleCallbackMutation = trpc.auth.googleCallback.useMutation({
    onSuccess: () => {
      navigate('/events')
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  useEffect(() => {
    // If there's an error parameter from Google, show it
    if (errorParam) {
      setError(`OAuth error: ${errorParam}`)
      return
    }

    // If we have code and state, process the OAuth callback
    if (code && state && !googleCallbackMutation.isPending && !googleCallbackMutation.isSuccess) {
      googleCallbackMutation.mutate({ code, state })
    } else if (!code || !state) {
      // Missing required parameters
      setError('Missing OAuth parameters. Please try logging in again.')
    }
  }, [code, state, errorParam])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg border text-center">
          <h2 className="text-2xl font-bold text-red-600">Authentication Failed</h2>
          <p className="text-gray-700">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="mt-4 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  // Show loading state while processing OAuth callback
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg border text-center">
        <h2 className="text-2xl font-bold">Completing Sign In...</h2>
        <p className="text-gray-600">Please wait while we complete your Google authentication.</p>
        <div className="flex justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  )
}
