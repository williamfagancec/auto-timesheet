import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { trpc } from '../lib/trpc'
import { useNavigate, Link } from 'react-router-dom'

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

type SignupForm = z.infer<typeof signupSchema>

export function Signup() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const signupMutation = trpc.auth.signup.useMutation({
    onSuccess: () => {
      navigate('/events')
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
  })

  const onSubmit = (data: SignupForm) => {
    setError(null)
    signupMutation.mutate(data)
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
        <div className="bg-gradient-to-r from-sandy via-sandy-light to-sandy px-xl py-2xl text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-mesh opacity-30" />
          <div className="relative flex flex-col items-center gap-md">
            <div className="w-48 h-48 flex items-center justify-center animate-bounce-subtle">
              <img src="/logo.png" alt="TimeSync Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <h2 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Get Started</h2>
              <p className="mt-xs text-sm text-text-secondary">
                Create your Auto Timesheet account
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
            <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-xs">
              Name (optional)
            </label>
            <input
              {...register('name')}
              type="text"
              id="name"
              className="input-primary"
              placeholder="Your name"
            />
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
              placeholder="At least 8 characters"
            />
            {errors.password && (
              <p className="mt-xs text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={signupMutation.isPending}
            className="btn-primary w-full justify-center shadow-md hover:shadow-glow"
          >
            {signupMutation.isPending ? (
              <>
                <div className="spinner w-4 h-4" />
                Creating account...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                Create Account
              </>
            )}
          </button>
        </form>

        <p className="mt-xl text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <Link to="/login" className="text-accent-orange hover:text-accent-orange-hover font-medium transition-colors duration-300">
            Login →
          </Link>
        </p>
        </div>
      </div>
    </div>
  )
}
