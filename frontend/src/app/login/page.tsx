'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/auth-context'
import { Lock, Mail, ChefHat, ArrowRight, AlertCircle, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
const RESTAURANT_NAME = process.env.NEXT_PUBLIC_RESTAURANT_NAME || "Savour Foods"

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const authStore = useAuthStore()

  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [hasLoggedInBefore, setHasLoggedInBefore] = useState(false)
  const [isReadOnly, setIsReadOnly] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loggedBefore = localStorage.getItem("has_logged_in_before") === "true"
    setHasLoggedInBefore(loggedBefore)
    const timer = setTimeout(() => setIsReadOnly(false), 600)
    return () => clearTimeout(timer)
  }, [])

  // 6. ALREADY LOGGED IN CHECK
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        try {
          const payload = JSON.parse(
            atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
          )
          const userRole = payload.user_role || payload.role
          if (userRole === "admin") router.replace("/admin")
        } catch {
          // ignore decode errors for invalid/expired sessions
        }
      }
    }
    checkSession()
  }, [router, supabase])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) {
      handleLogin(e as any)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    if (e?.preventDefault) e.preventDefault()
    setLoading(true)
    setError(null)

    const currentEmail = adminEmail
    const currentPassword = adminPassword

    try {
      // 4. LOGIN LOGIC — Call POST /api/auth/login on FastAPI backend
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: currentEmail, password: currentPassword }),
      })

      if (!res.ok) {
        let errMessage = "Invalid email or password."
        try {
          const errData = await res.json()
          if (errData.detail) errMessage = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail)
        } catch {
          // fallback error
        }
        throw new Error(errMessage)
      }

      const data = await res.json()

      // STEP A — Role check
      if (data.role !== "admin") {
        setError("Access denied. Admin privileges required.")
        setLoading(false)
        return
      }

      // STEP B — Store token and role
      authStore.setToken(data.access_token)
      authStore.setRole(data.role)
      authStore.setDisplayName(data.display_name)

      // STEP C — Establish Supabase client session
      try {
        const { error: sbError } = await supabase.auth.signInWithPassword({
          email: currentEmail,
          password: currentPassword,
        })
        if (sbError) {
          console.error("Supabase session sign-in failed:", sbError.message)
        }
      } catch (sbErr) {
        console.error("Supabase session sign-in exception:", sbErr)
      }

      // STEP D — Redirect
      localStorage.setItem("has_logged_in_before", "true")
      setHasLoggedInBefore(true)
      setAdminEmail("")
      setAdminPassword("")
      router.replace("/admin")
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setError("Connection error. Make sure the backend is running.")
      } else {
        setError(err.message || "Invalid email or password.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0d0914] to-slate-900 flex items-center justify-center p-4 selection:bg-[#8a2be2]/30 selection:text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-[#8a2be2]/10 via-transparent to-transparent pointer-events-none" />
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md relative z-10"
      >
        {/* 7. RESTAURANT NAME */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#8a2be2] to-purple-400 p-0.5 shadow-lg shadow-[#8a2be2]/20 mb-3">
            <div className="w-full h-full bg-[#0d0914] rounded-[14px] flex items-center justify-center">
              <ChefHat className="w-7 h-7 text-purple-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1 font-serif">
            {RESTAURANT_NAME}
          </h1>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-teal-400 font-sans text-sm font-semibold tracking-wider uppercase block">
            Portal Access
          </span>
        </div>

        <div className="bg-[#1a1525]/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
          <div className="mb-6 text-center">
            <div className="inline-block mb-2">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#8a2be2]/10 text-purple-300 border border-[#8a2be2]/30">
                Admin access
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mb-1">
              Welcome back, Admin
            </h2>
            <p className="text-xs text-[#a09eb0]">
              Sign in to manage menu and orders
            </p>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mb-6 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-red-300 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* 3. FORM FIELDS */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 block">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  name="savour_auth_email_field"
                  id="savour_auth_email_field"
                  required
                  readOnly={isReadOnly}
                  onFocus={() => setIsReadOnly(false)}
                  onClick={() => setIsReadOnly(false)}
                  autoComplete="new-password"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter admin email address"
                  className="w-full pl-10 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all duration-200 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 block">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  name="savour_auth_pwd_field"
                  id="savour_auth_pwd_field"
                  required
                  readOnly={isReadOnly}
                  onFocus={() => setIsReadOnly(false)}
                  onClick={() => setIsReadOnly(false)}
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 transition-all duration-200 text-sm"
                />
              </div>
            </div>

            {/* 5. LOADING STATE & SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3.5 px-4 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all duration-300 text-white disabled:opacity-50 disabled:pointer-events-none bg-gradient-to-r from-[#8a2be2] to-purple-600 hover:from-purple-500 hover:to-[#8a2be2] shadow-[#8a2be2]/25"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign in as Admin</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Secure Admin Access Control • Shared Device Safe</span>
          </div>
        </div>

        <div className="text-center mt-5">
          <button 
            onClick={() => router.push('/')}
            className="text-xs text-slate-400 hover:text-white transition-colors underline-offset-4 hover:underline"
          >
            ← Back to Customer Voice Ordering App
          </button>
        </div>
      </motion.div>
    </div>
  )
}
