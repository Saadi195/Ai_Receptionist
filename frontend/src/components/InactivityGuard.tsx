'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/auth-context'
import { ShieldAlert, LogOut, Clock, CheckCircle2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const COUNTDOWN_SECONDS = 60 // 60 seconds warning countdown

export default function InactivityGuard() {
  const router = useRouter()
  const supabase = createClient()
  const { clearAuth } = useAuthStore()

  const [showModal, setShowModal] = useState(false)
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)
  
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastActivityRef = useRef<number>(Date.now())

  const handleLogout = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    try {
      await supabase.auth.signOut()
    } catch {
      // Ignore network errors on sign out
    }
    clearAuth()
    router.push('/login')
  }, [supabase, clearAuth, router])

  const resetTimer = useCallback(() => {
    if (showModal) return // Don't reset if modal is already active; must explicitly click button
    lastActivityRef.current = Date.now()
    if (timerRef.current) clearTimeout(timerRef.current)
    
    timerRef.current = setTimeout(() => {
      setShowModal(true)
      setCountdown(COUNTDOWN_SECONDS)
    }, INACTIVITY_TIMEOUT_MS)
  }, [showModal])

  const handleDismissModal = () => {
    setShowModal(false)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    resetTimer()
  }

  // Set up event listeners for activity tracking
  useEffect(() => {
    resetTimer()

    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click']
    const handleActivity = () => {
      // Debounce checks so we don't spam timer resets on every pixel mousemove
      if (Date.now() - lastActivityRef.current > 1000) {
        resetTimer()
      }
    }

    events.forEach(event => document.addEventListener(event, handleActivity, { passive: true }))

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      events.forEach(event => document.removeEventListener(event, handleActivity))
    }
  }, [resetTimer])

  // Handle countdown interval when modal is open
  useEffect(() => {
    if (showModal) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
            handleLogout()
            return 0
          }
          return prev - 1
        })
      }, 1000)

      return () => {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
      }
    }
  }, [showModal, handleLogout])

  return (
    <AnimatePresence>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-slate-900 border-2 border-amber-500/50 rounded-3xl p-6 max-w-md w-full shadow-2xl shadow-amber-500/10 text-center relative overflow-hidden"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4 animate-pulse">
              <Clock className="w-8 h-8" />
            </div>

            <h3 className="text-xl font-bold text-white mb-2 font-serif">
              Still There?
            </h3>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Your session has been inactive for 30 minutes. To protect sensitive customer and menu data, you will be automatically logged out in:
            </p>

            <div className="text-4xl font-mono font-bold text-amber-400 mb-6 py-3 px-6 rounded-2xl bg-slate-950/60 border border-slate-800 inline-block">
              00:{countdown < 10 ? `0${countdown}` : countdown}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleLogout}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Log Out Now</span>
              </button>
              <button
                onClick={handleDismissModal}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-sm font-bold shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>I&apos;m Still Here</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
