import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export function AuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const errorParam = searchParams.get('error')

  useEffect(() => {
    // If there's an error, show it; otherwise redirect to login
    if (!errorParam) {
      navigate('/login')
    }
  }, [errorParam, navigate])

  if (errorParam) {
    const errorMessages: Record<string, string> = {
      missing_oauth_params: 'OAuth parameters are missing',
      invalid_oauth_state: 'Invalid OAuth state - please try again',
      oauth_failed: 'OAuth authentication failed',
    }

    const errorMessage = errorMessages[errorParam] || 'An unknown error occurred'

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg border text-center">
          <h2 className="text-2xl font-bold text-red-600">Authentication Failed</h2>
          <p className="text-gray-700">{errorMessage}</p>
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

  return null
}
