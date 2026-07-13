"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Menu, Mail } from "lucide-react"
import { isAuthenticated, isTokenExpired, clearAuth } from "@/lib/auth"
import { Sidebar } from "@/components/Sidebar"
import { ClientProvider } from "@/lib/clientContext"

// Routes that don't require authentication
const PUBLIC_PATHS = ["/login", "/landing"]

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [ready,       setReady]       = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
      setReady(true)
      return
    }
    if (isAuthenticated() && isTokenExpired()) {
      clearAuth()
      router.replace("/login")
    } else if (!isAuthenticated()) {
      router.replace("/landing")
    } else {
      setReady(true)
    }
  }, [pathname, router])

  // Close sidebar automatically on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  if (!ready) return null

  // Public pages — render without sidebar/shell
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return <>{children}</>
  }

  return (
    <ClientProvider>
      {/* Sidebar (handles its own mobile translate logic) */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile top bar — visible only below lg breakpoint */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-slate-900 border-b border-slate-700 flex items-center px-4 z-10 gap-3">
        <button
          onClick={() => setSidebarOpen(true)}
          className="text-slate-400 hover:text-white transition-colors p-1 -ml-1"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 bg-indigo-600 rounded flex items-center justify-center">
            <Mail className="h-3 w-3 text-white" />
          </div>
          <span className="text-white font-bold text-sm tracking-wide">Email Dashboard</span>
        </div>
      </header>

      {/* Main content — offset for sidebar on desktop, offset for top bar on mobile */}
      <div className="lg:ml-[220px] pt-14 lg:pt-0 flex flex-col min-h-full">
        {children}
      </div>
    </ClientProvider>
  )
}
