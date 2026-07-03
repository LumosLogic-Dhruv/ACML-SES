"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Mail, LogOut, Key, Users, Building2, X, BookOpen, FileBarChart2, Settings, ShieldOff, AlertTriangle } from "lucide-react"
import { clearAuth } from "@/lib/auth"
import { useClient } from "@/lib/clientContext"

const clientNavItems = [
  { label: "Dashboard",     href: "/",             icon: LayoutDashboard },
  { label: "Recent Emails", href: "/recent",       icon: Mail },
  { label: "Reports",       href: "/reports",      icon: FileBarChart2 },
  { label: "Bounces",       href: "/bounces",      icon: AlertTriangle },
  { label: "Suppression",   href: "/suppression",  icon: ShieldOff },
  { label: "Settings",      href: "/settings",     icon: Settings },
]

const adminNavItems = [
  { label: "Dashboard",     href: "/",             icon: LayoutDashboard },
  { label: "Recent Emails", href: "/recent",       icon: Mail },
  { label: "Reports",       href: "/reports",      icon: FileBarChart2 },
  { label: "Bounces",       href: "/bounces",      icon: AlertTriangle },
  { label: "Clients",       href: "/clients",      icon: Key },
  { label: "Users",         href: "/users",        icon: Users },
  { label: "Suppression",   href: "/suppression",  icon: ShieldOff },
  { label: "Settings",      href: "/settings",     icon: Settings },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const { role, clients, selectedClientId, selectedClientName, setSelectedClientId, username } = useClient()

  function handleLogout() {
    clearAuth()
    router.replace("/login")
  }

  const navItems = role === "admin" ? adminNavItems : clientNavItems
  const initials = username ? username.slice(0, 2).toUpperCase() : "?"

  return (
    <>
      {/* Backdrop — mobile only */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`sidebar-backdrop fixed inset-0 bg-black/50 z-10 lg:hidden ${isOpen ? "sidebar-open" : ""}`}
      />

      {/* Sidebar panel */}
      <aside
        className={`sidebar-panel fixed left-0 top-0 h-full w-[220px] bg-slate-900 flex flex-col z-20 ${isOpen ? "sidebar-open" : ""}`}
      >
        {/* Header */}
        <div className="px-5 py-5 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white font-bold text-sm tracking-wide uppercase">Email Dashboard</h2>
          {/* Close — mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden text-slate-400 hover:text-white transition-colors"
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Company — client role */}
        {role === "client" && selectedClientName && (
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs text-slate-500 uppercase tracking-wide px-2 mb-1.5 flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Company
            </p>
            <p className="text-xs text-white px-2.5 py-2 bg-slate-800 rounded-lg truncate">
              {selectedClientName}
            </p>
          </div>
        )}

        {/* Company selector — admin */}
        {role === "admin" && clients.length > 0 && (
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs text-slate-500 uppercase tracking-wide px-2 mb-1.5 flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> Company
            </p>
            <select
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 text-white text-xs rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.client_name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ label, href, icon: Icon }) => {
            const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            )
          })}

          {/* Docs section */}
          <div className="pt-3 pb-1">
            <p className="text-xs text-slate-500 uppercase tracking-wide px-2 mb-1.5">Docs</p>
          </div>
          <a
            href="/api-reference.html"
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            API Reference
          </a>
        </nav>

        {/* Profile + Logout */}
        <div className="px-3 py-4 border-t border-slate-700 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800">
            <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate capitalize">{username || "—"}</p>
              <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${
                role === "admin"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "bg-emerald-500/20 text-emerald-300"
              }`}>
                {role || "—"}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Logout
          </button>
        </div>
      </aside>
    </>
  )
}
