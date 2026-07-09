'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/auth-context'
import InactivityGuard from '@/components/InactivityGuard'
import {
  LayoutDashboard,
  Utensils,
  ClipboardList,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  RefreshCw,
  Search,
  DollarSign,
  Clock,
  AlertTriangle,
  LogOut,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Loader2,
  ChefHat,
  Sparkles
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NEXT_PUBLIC_BACKEND_WS_URL?.replace("ws://", "http://").replace("wss://", "https://") ?? "http://localhost:8000")

interface MenuItem {
  id: string
  canonical_name: string
  urdu_name?: string
  category: string
  price: number
  available: boolean
  preparation_minutes?: number
}

interface OrderItem {
  canonical_name: string
  quantity: string | number
  unit_price: number
  line_total: number
}

interface Order {
  id: string
  session_id: string
  items: OrderItem[]
  total_amount: number
  status: string
  created_at: string
}


export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const { accessToken, role, displayName, setAuth, clearAuth } = useAuthStore()

  const [activeTab, setActiveTab] = useState<'menu' | 'orders'>('menu')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Menu State
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null)
  const [newPriceVal, setNewPriceVal] = useState<string>('')
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false)
  const [newItem, setNewItem] = useState({
    canonical_name: '',
    urdu_name: '',
    category: 'main',
    price: '',
    available: true,
    preparation_minutes: 15
  })

  // Orders State
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)


  // Restore session if memory store empty
  useEffect(() => {
    const initAuth = async () => {
      if (!accessToken) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          router.push('/login')
          return
        }
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        
        const userRole = profile?.role || 'admin'
        if (userRole !== 'admin') {
          router.push('/login')
          return
        }
        setAuth(session.access_token, userRole, profile?.display_name || 'Admin', session.user.id)
      } else if (role !== 'admin') {
        router.push('/login')
      }
      setLoading(false)
    }
    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        useAuthStore.setState({ accessToken: session.access_token })
      }
      if (event === "SIGNED_OUT") {
        clearAuth()
        router.push("/login")
      }
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [accessToken, role, router, setAuth, clearAuth, supabase])

  const getHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${useAuthStore.getState().accessToken}`
  }), [])

  // Fetch Data
  const fetchMenu = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/menu/all`, { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setMenuItems(data)
      }
    } catch (err) {
      console.error('Failed to fetch menu:', err)
    }
  }, [getHeaders])

  const fetchOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/orders/today`, { headers: getHeaders() })
      if (res.ok) {
        const data = await res.json()
        setTodayOrders(data)
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    } finally {
      setOrdersLoading(false)
    }
  }, [getHeaders])

  useEffect(() => {
    if (!loading && accessToken) {
      fetchMenu()
      fetchOrders()
    }
  }, [loading, accessToken, fetchMenu, fetchOrders])

  // Auto refresh orders every 30s
  useEffect(() => {
    if (activeTab === 'orders' && !loading) {
      const interval = setInterval(fetchOrders, 30000)
      return () => clearInterval(interval)
    }
  }, [activeTab, loading, fetchOrders])

  // Menu Actions
  const toggleAvailability = async (id: string, currentVal: boolean) => {
    // Optimistic update
    setMenuItems(prev => prev.map(item => item.id === id ? { ...item, available: !currentVal } : item))
    try {
      const res = await fetch(`${API_URL}/api/menu/${id}/availability`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ available: !currentVal })
      })
      if (!res.ok) fetchMenu()
    } catch {
      fetchMenu()
    }
  }

  const savePrice = async (id: string) => {
    const price = parseInt(newPriceVal, 10)
    if (isNaN(price) || price < 0) return
    setEditingPriceId(null)
    setMenuItems(prev => prev.map(item => item.id === id ? { ...item, price } : item))
    try {
      await fetch(`${API_URL}/api/menu/${id}/price`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ price })
      })
    } catch {
      fetchMenu()
    }
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_URL}/api/menu/items`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          ...newItem,
          price: parseInt(newItem.price, 10) || 0
        })
      })
      if (res.ok) {
        setIsAddItemModalOpen(false)
        setNewItem({ canonical_name: '', urdu_name: '', category: 'main', price: '', available: true, preparation_minutes: 15 })
        fetchMenu()
      } else {
        const errData = await res.json()
        alert(errData.detail || 'Failed to add item')
      }
    } catch (err) {
      alert('Error adding item')
    }
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this menu item?')) return
    setMenuItems(prev => prev.filter(item => item.id !== id))
    try {
      await fetch(`${API_URL}/api/menu/items/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      })
    } catch {
      fetchMenu()
    }
  }


  const handleLogout = async () => {
    await supabase.auth.signOut()
    clearAuth()
    router.push('/')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-amber-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    )
  }

  // Filtered menu
  const categories = ['all', ...Array.from(new Set(menuItems.map(i => i.category)))]
  const filteredMenu = menuItems.filter(item => {
    const matchesCat = selectedCategory === 'all' || item.category === selectedCategory
    const matchesSearch = item.canonical_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.urdu_name && item.urdu_name.includes(searchQuery))
    return matchesCat && matchesSearch
  })

  // Order stats
  const totalRevenue = todayOrders.reduce((acc, curr) => acc + (curr.total_amount || 0), 0)
  const activeOrdersCount = todayOrders.filter(o => o.status === 'pending' || o.status === 'preparing').length
  const readyOrdersCount = todayOrders.filter(o => o.status === 'ready').length

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-amber-500/30 selection:text-amber-200">
      <InactivityGuard />
      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center text-slate-950 shadow-md shadow-amber-500/20">
              <ChefHat className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold tracking-tight text-white font-serif text-lg">Savour Foods</span>
              <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                Admin Panel
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-300">{displayName}</span>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-800 bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-8">
          <button
            onClick={() => setActiveTab('menu')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition-all relative ${
              activeTab === 'menu'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>Menu Management</span>
            {activeTab === 'menu' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 inset-x-0 h-0.5 bg-amber-500" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition-all relative ${
              activeTab === 'orders'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            <span>Today&apos;s Orders</span>
            <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-slate-800 text-slate-300 font-mono">
              {todayOrders.length}
            </span>
            {activeTab === 'orders' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 inset-x-0 h-0.5 bg-amber-500" />
            )}
          </button>

        </div>
      </div>

      {/* Tab Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-4 rounded-2xl border border-slate-800/80">
                <div className="flex items-center gap-3 flex-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search menu items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="flex gap-1 overflow-x-auto pb-2 sm:pb-0">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold uppercase tracking-wider transition-colors ${
                          selectedCategory === cat
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setIsAddItemModalOpen(true)}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-xl text-sm shadow-md shadow-amber-500/20 flex items-center gap-2 justify-center transition-all shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Menu Item</span>
                </button>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-4 px-6">Item Name</th>
                      <th className="py-4 px-6">Category</th>
                      <th className="py-4 px-6">Price (PKR)</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {filteredMenu.map(item => (
                      <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-semibold text-white">{item.canonical_name}</div>
                          {item.urdu_name && <div className="text-xs text-amber-400/80 font-serif mt-0.5">{item.urdu_name}</div>}
                        </td>
                        <td className="py-4 px-6">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-medium uppercase tracking-wider bg-slate-800 text-slate-300">
                            {item.category}
                          </span>
                        </td>
                        <td className="py-4 px-6 font-mono font-medium text-amber-300">
                          {editingPriceId === item.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                value={newPriceVal}
                                onChange={(e) => setNewPriceVal(e.target.value)}
                                className="w-24 px-2 py-1 bg-slate-950 border border-amber-500/50 rounded-lg text-white text-sm focus:outline-none"
                                autoFocus
                              />
                              <button onClick={() => savePrice(item.id)} className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingPriceId(null)} className="p-1 text-red-400 hover:bg-red-500/10 rounded">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 group">
                              <span>PKR {item.price}</span>
                              <button
                                onClick={() => { setEditingPriceId(item.id); setNewPriceVal(item.price.toString()); }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-amber-400 transition-opacity"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <button
                            onClick={() => toggleAvailability(item.id, item.available)}
                            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                              item.available
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {item.available ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                            <span>{item.available ? 'Available' : 'Out of Stock'}</span>
                          </button>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                            title="Soft Delete Item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredMenu.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500">
                          No menu items found matching your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {activeTab === 'orders' && (
            <motion.div
              key="orders"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Orders Today</div>
                  <div className="text-2xl font-bold font-mono text-white">{todayOrders.length}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Total Revenue</div>
                  <div className="text-2xl font-bold font-mono text-amber-400">PKR {totalRevenue.toLocaleString()}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Active Kitchen Orders</div>
                  <div className="text-2xl font-bold font-mono text-orange-400">{activeOrdersCount}</div>
                </div>
                <div className="bg-slate-900/60 border border-slate-800/80 p-5 rounded-2xl">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Completed / Ready</div>
                  <div className="text-2xl font-bold font-mono text-emerald-400">{readyOrdersCount}</div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Today&apos;s Order Log</h2>
                <button
                  onClick={fetchOrders}
                  disabled={ordersLoading}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${ordersLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh Now</span>
                </button>
              </div>

              <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl overflow-hidden shadow-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-4 px-6">Order ID</th>
                      <th className="py-4 px-6">Time</th>
                      <th className="py-4 px-6">Items Summary</th>
                      <th className="py-4 px-6">Total Amount</th>
                      <th className="py-4 px-6 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {todayOrders.map(order => (
                      <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-4 px-6 font-mono text-xs text-slate-400">
                          {order.id ? order.id.slice(0, 8) : 'N/A'}...
                        </td>
                        <td className="py-4 px-6 text-xs text-slate-400">
                          {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-4 px-6">
                          <div className="space-y-1">
                            {order.items?.map((item, idx) => (
                              <div key={idx} className="text-xs text-slate-200">
                                <span className="font-semibold text-amber-400">{item.quantity}x</span> {item.canonical_name}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono font-medium text-amber-300">
                          PKR {order.total_amount}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                            order.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                            order.status === 'preparing' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                            order.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {todayOrders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500">
                          No orders recorded yet today.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Add Item Modal */}
      {isAddItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-white">Add New Menu Item</h3>
              <button onClick={() => setIsAddItemModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-300 block mb-1">Canonical Name (English)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chicken Biryani"
                  value={newItem.canonical_name}
                  onChange={(e) => setNewItem({ ...newItem, canonical_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold uppercase text-slate-300 block mb-1">Urdu Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. چکن بریانی"
                  value={newItem.urdu_name}
                  onChange={(e) => setNewItem({ ...newItem, urdu_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50 font-serif"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-300 block mb-1">Category</label>
                  <select
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="Main Course">Main Course</option>
                    <option value="Starters">Starters</option>
                    <option value="Beverages">Beverages</option>
                    <option value="Desserts">Desserts</option>
                    <option value="Breads">Breads</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase text-slate-300 block mb-1">Price (PKR)</label>
                  <input
                    type="number"
                    required
                    placeholder="e.g. 650"
                    value={newItem.price}
                    onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddItemModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-xl text-sm"
                >
                  Save Item
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

    </div>
  )
}
