import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trpc } from '../lib/trpc'
import { useNavigate } from 'react-router-dom'

const INACTIVITY_TIMEOUT = 3600 * 1000 // 1 hour in milliseconds

/**
 * Custom hook that tracks user activity and automatically logs out users
 * after 1 hour of inactivity.
 * 
 * Tracks: mouse movements, clicks, keyboard input, scroll, focus, and visibility changes
 */
export function useInactivityTimeout(isAuthenticated: boolean) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Clear all queries/cache
      queryClient.clear()
      // Show user-friendly message
      alert('You have been logged out due to inactivity. Please log in again to continue.')
      // Redirect to login
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      console.error('Logout error during inactivity timeout:', error)
      // Even if logout fails, clear cache and redirect
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  const resetTimer = useCallback(() => {
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Only set timeout if user is authenticated
    if (isAuthenticated) {
      lastActivityRef.current = Date.now()
      
      // Set new timeout
      timeoutRef.current = setTimeout(() => {
        console.log('[InactivityTimeout] 1 hour of inactivity detected - logging out user')
        logoutMutation.mutate()
      }, INACTIVITY_TIMEOUT)
    }
  }, [isAuthenticated, logoutMutation])

  const handleActivity = useCallback(() => {
    resetTimer()
  }, [resetTimer])

  useEffect(() => {
    // Only set up activity tracking if user is authenticated
    if (!isAuthenticated) {
      // Clear timeout if user is not authenticated
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      return
    }

    // Initialize timer on mount
    resetTimer()

    // Track various user activities
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
      'keydown',
    ]

    // Add event listeners
    for (const event of events) {
      document.addEventListener(event, handleActivity, true)
    }

    // Track window focus/blur
    const handleFocus = () => {
      handleActivity()
    }

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // User returned to the tab - check if we've been inactive too long
        const timeSinceLastActivity = Date.now() - lastActivityRef.current
        if (timeSinceLastActivity >= INACTIVITY_TIMEOUT) {
          // User has been away too long - log them out
          console.log('[InactivityTimeout] User returned after inactivity period - logging out')
          logoutMutation.mutate()
        } else {
          // Reset timer since user is back
          handleActivity()
        }
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // Cleanup
    return () => {
      for (const event of events) {
        document.removeEventListener(event, handleActivity, true)
      }
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [isAuthenticated, handleActivity, logoutMutation, resetTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])
}

