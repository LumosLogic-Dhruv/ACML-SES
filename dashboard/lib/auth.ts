const TOKEN_KEY = 'acml_token'
const API_KEY_STORAGE = 'acml_api_key'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(API_KEY_STORAGE)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export function isTokenExpired(): boolean {
  const payload = decodeToken()
  if (!payload?.exp) return false
  return Date.now() >= payload.exp * 1000
}

export function getStoredApiKey(): string {
  if (typeof window === 'undefined') return process.env.NEXT_PUBLIC_API_KEY || ''
  return localStorage.getItem(API_KEY_STORAGE) || process.env.NEXT_PUBLIC_API_KEY || ''
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key)
}

export interface TokenPayload {
  userId: string
  username: string
  role: string
  clientId: string | null
  exp?: number
}

export function decodeToken(): TokenPayload | null {
  const token = getToken()
  if (!token) return null
  try {
    const base64Url = token.split('.')[1]
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
    return JSON.parse(atob(padded)) as TokenPayload
  } catch {
    return null
  }
}
