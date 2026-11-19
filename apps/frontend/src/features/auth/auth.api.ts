import { apiClient } from '../../lib/api-client.js'

export interface AuthUser { id: string; name: string; email: string; employeeId?: string; role: 'ADMIN' | 'SALESPERSON' }
export const authApi = {
  async me(): Promise<AuthUser> { return (await apiClient.get<{ data: AuthUser }>('/auth/me')).data.data },
  async login(identifier: string, password: string): Promise<AuthUser> { return (await apiClient.post<{ data: AuthUser }>('/auth/login', { identifier, password })).data.data },
  async logout(): Promise<void> { await apiClient.post('/auth/logout') },
}
