import { create } from 'zustand'

interface AuthState {
  accessToken: string | null
  role: 'admin' | null
  displayName: string | null
  userId: string | null
  setAuth: (token: string, role: 'admin', name: string, userId?: string) => void
  setToken: (token: string | null) => void
  setRole: (role: 'admin' | null) => void
  setDisplayName: (name: string | null) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  role: null,
  displayName: null,
  userId: null,
  setAuth: (token, role, name, userId) =>
    set({ accessToken: token, role, displayName: name, userId: userId || null }),
  setToken: (token) => set({ accessToken: token }),
  setRole: (role) => set({ role }),
  setDisplayName: (name) => set({ displayName: name }),
  clearAuth: () =>
    set({ accessToken: null, role: null, displayName: null, userId: null }),
  isAuthenticated: () => get().accessToken !== null,
  isAdmin: () => get().role === 'admin',
}))
