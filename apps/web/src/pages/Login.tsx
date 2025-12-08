import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { trpc } from '../lib/trpc'
import { useNavigate, Link } from 'react-router-dom'

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

type LoginForm = z.infer<typeof loginSchema>

export function Login() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      navigate('/events')
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const googleOAuthMutation = trpc.auth.googleOAuth.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = (data: LoginForm) => {
    setError(null)
    loginMutation.mutate(data)
  }

  const handleGoogleLogin = () => {
    setError(null)
    googleOAuthMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sandy-light via-bg-secondary to-sandy-light relative overflow-hidden">
      {/* Animated background decoration */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-from-orange opacity-10 rounded-full blur-3xl animate-pulse-glow" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-from-purple opacity-10 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '1s' }} />
      </div>

      <div className="max-w-md w-full bg-white rounded-xl border border-border-light shadow-xl overflow-hidden animate-scale-in relative z-10">
        {/* Logo Header */}
        <div className="px-xl py-2xl text-center relative overflow-hidden" style={{ backgroundColor: '#f9f9f1' }}>
          <div className="absolute inset-0 bg-gradient-mesh opacity-30" />
          <div className="relative flex flex-col items-center gap-md">
            <div className="w-32 h-32 flex items-center justify-center animate-bounce-subtle">
              <img src="/logo.png" alt="TimeSync Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Welcome Back</h2>
              <p className="mt-xs text-sm text-text-secondary">
                Sign in to your Auto Timesheet account
              </p>
            </div>
          </div>
        </div>
        <div className="p-xl">

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-lg">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-md py-md rounded-md text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-xs">
              Email
            </label>
            <input
              {...register('email')}
              type="email"
              id="email"
              className="input-primary"
              placeholder="you@example.com"
            />
            {errors.email && (
              <p className="mt-xs text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-xs">
              Password
            </label>
            <input
              {...register('password')}
              type="password"
              id="password"
              className="input-primary"
              placeholder="Enter your password"
            />
            {errors.password && (
              <p className="mt-xs text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="btn-primary w-full justify-center shadow-md hover:shadow-glow"
          >
            {loginMutation.isPending ? (
              <>
                <div className="spinner w-4 h-4" />
                Logging in...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Login
              </>
            )}
          </button>
        </form>

        <div className="relative my-xl">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border-light" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-md bg-white text-text-tertiary font-medium">Or</span>
          </div>
        </div>

        <button
          onClick={handleGoogleLogin}
          disabled={googleOAuthMutation.isPending}
          className="w-full flex items-center justify-center gap-sm bg-white text-text-primary border border-border-light px-lg py-sm rounded-lg text-sm font-medium cursor-pointer transition-all duration-300 hover:bg-bg-hover hover:shadow-md hover:border-border-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {googleOAuthMutation.isPending ? (
            <>
              <div className="spinner w-4 h-4" />
              <span>Redirecting...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>Continue with Google</span>
            </>
          )}
        </button>

        <p className="mt-xl text-center text-sm text-text-secondary">
          Don't have an account?{' '}
          <Link to="/signup" className="text-accent-orange hover:text-accent-orange-hover font-medium transition-colors duration-300">
            Sign up →
          </Link>
        </p>
        </div>
      </div>
    </div>
  )
}
