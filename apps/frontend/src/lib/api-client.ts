import axios from 'axios'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

let refreshRequest: Promise<void> | null = null
apiClient.interceptors.response.use((response) => response, async (error: unknown) => {
  if (!axios.isAxiosError(error) || !error.config || error.response?.status !== 401) throw error
  const request = error.config
  const url = request.url || ''
  if (request.headers['X-Auth-Retry'] || url.includes('/auth/login') || url.includes('/auth/refresh')) throw error
  request.headers['X-Auth-Retry'] = 'true'
  refreshRequest ??= apiClient.post('/auth/refresh').then(() => undefined).finally(() => { refreshRequest = null })
  await refreshRequest
  return apiClient(request)
})

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError<{ error?: string }>(error)) return error.response?.data?.error || fallback
  return fallback
}
