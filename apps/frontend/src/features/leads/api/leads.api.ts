import { apiClient } from '../../../lib/api-client.js'
import type { LeadRecord } from '@elucidate-crm/shared'

export interface LeadListResponse { data: LeadRecord[]; pagination: { page: number; limit: number; total: number; pages: number } }
export const leadsApi = {
  async list(search = '', status?: string, claimedOnly = false): Promise<LeadListResponse> {
    return (await apiClient.get<LeadListResponse>('/leads', { params: { page: 1, limit: 100, search: search || undefined, status, claimedOnly: claimedOnly || undefined } })).data
  },
  async create(input: { name?: string; phone: string }): Promise<LeadRecord> {
    return (await apiClient.post<{ data: LeadRecord }>('/leads', input)).data.data
  },
  async status(id: string, status: string, reason?: string): Promise<LeadRecord> {
    return (await apiClient.patch<{ data: LeadRecord }>(`/leads/${id}/status`, { status, reason })).data.data
  },
  async remark(id: string, message: string): Promise<void> { await apiClient.post(`/leads/${id}/remarks`, { message }) },
  async detail(id: string): Promise<LeadRecord> { return (await apiClient.get<{ data: LeadRecord }>(`/leads/${id}`)).data.data },
  async transfer(id: string, newOwnerId: string, reason?: string): Promise<void> { await apiClient.post(`/leads/${id}/transfer`, { newOwnerId, reason }) },
  async markJunk(id: string, reason: string): Promise<void> { await apiClient.post(`/leads/${id}/junk`, { reason }) },
  async doNotContact(id: string, value: boolean): Promise<void> { await apiClient.patch(`/leads/${id}`, { doNotContact: value }) },
  async scheduleFollowUp(id: string, followUpAt: string | null): Promise<void> { await apiClient.patch(`/leads/${id}`, { followUpAt }) },
  async qualifyingActivity(id: string, message: string): Promise<void> { await apiClient.post(`/leads/${id}/activities`, { type: 'QUALIFYING_INTERACTION', message }) },
  async createQuotation(input: { leadId: string; customer: { instituteName: string; mobile: string; billingAddress: string; city: string; state: string; pincode: string }; amount: number; status: 'DRAFT' }): Promise<void> { await apiClient.post('/quotations', input) },
}

export interface ClaimLead { _id: string; name: string; phone: string; status: string; claimEligibleAt: string; claimPoolEnteredAt: string; createdBy?: { name: string } }
export const claimsApi = {
  async list(): Promise<ClaimLead[]> { return (await apiClient.get<{ data: ClaimLead[] }>('/lead-claims')).data.data },
  async claim(id: string): Promise<void> { await apiClient.post(`/lead-claims/${id}/claim`) },
}

export interface DashboardSummary { total: number; statuses: Record<string, number>; availableToClaim: number; myClaimed: number; followUpsDue: number }
export const dashboardApi = {
  async summary(): Promise<DashboardSummary> { return (await apiClient.get<{ data: DashboardSummary }>('/dashboard/summary')).data.data },
  async leads(page = 1, limit = 20): Promise<LeadListResponse> { return (await apiClient.get<LeadListResponse>('/dashboard/leads', { params: { page, limit } })).data },
}

export interface NotificationItem { _id: string; message: string; type: string; leadId?: string | null; createdAt: string; readAt: string | null }
export const notificationsApi = {
  async list(): Promise<{ data: NotificationItem[]; unread: number }> { return (await apiClient.get<{ data: NotificationItem[]; unread: number }>('/notifications')).data },
  async transfers(): Promise<NotificationItem[]> { return (await apiClient.get<{ data: NotificationItem[] }>('/transfer-requests')).data.data },
  async read(id: string): Promise<void> { await apiClient.patch(`/notifications/${id}/read`) },
}

export const mobilePushApi = {
  async publicKey(): Promise<string> { return (await apiClient.get<{ publicKey: string }>('/push/public-key')).data.publicKey },
  async subscribe(subscription: PushSubscriptionJSON): Promise<void> { await apiClient.post('/push/subscribe', subscription) },
  async unsubscribe(endpoint: string): Promise<void> { await apiClient.delete('/push/subscribe', { data: { endpoint } }) },
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE'
export interface AttendanceRecord { _id: string; status: AttendanceStatus; checkIn: string; checkOut: string; checkInAt?: string | null; checkOutAt?: string | null; note: string; date: string }
export interface AttendanceEmployee { _id: string; name: string; employeeId?: string; email: string; attendance: AttendanceRecord | null }
export const attendanceApi = {
  async list(date: string): Promise<AttendanceEmployee[]> { return (await apiClient.get<{ data: AttendanceEmployee[] }>('/attendance', { params: { date } })).data.data },
  async mine(date: string): Promise<AttendanceRecord | null> { return (await apiClient.get<{ data: AttendanceRecord | null }>('/attendance/mine', { params: { date } })).data.data },
  async punchIn(date: string, location: { latitude: number; longitude: number; accuracy: number }): Promise<AttendanceRecord> { return (await apiClient.post<{ data: AttendanceRecord }>('/attendance/punch-in', { date, ...location })).data.data },
  async punchOut(date: string, location: { latitude: number; longitude: number; accuracy: number }): Promise<AttendanceRecord> { return (await apiClient.post<{ data: AttendanceRecord }>('/attendance/punch-out', { date, ...location })).data.data },
  async save(userId: string, input: { date: string; status: AttendanceStatus; checkIn: string; checkOut: string; note: string }): Promise<void> { await apiClient.put(`/attendance/${userId}`, input) },
}
