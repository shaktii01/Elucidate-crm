import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CalendarCheck2, ChartNoAxesColumnIncreasing, LayoutDashboard, LogOut, MoreVertical, Plus, Search, Settings, ShieldAlert, SlidersHorizontal, Users, ArrowDownUp, Phone, X, MoveRight, Clock3, Handshake, FileText, Eye, MessageSquareText, ArrowLeftRight, Ban, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, apiErrorMessage } from '../../../lib/api-client.js'
import { authApi } from '../../auth/auth.api.js'
import { useAuthStore } from '../../../stores/auth.store.js'
import { attendanceApi, claimsApi, dashboardApi, leadsApi, mobilePushApi, notificationsApi, type AttendanceStatus, type ClaimLead, type DashboardSummary, type NotificationItem } from '../api/leads.api.js'
import type { LeadRecord } from '@elucidate-crm/shared'
import '../../../styles/App.css'
import '../../../styles/overrides.css'
import '../../../styles/detail-panel.css'

type LeadStatus = 'NEW' | 'HOT' | 'WARM' | 'COLD' | 'NOT_CONNECTED' | 'NOT_INTERESTED' | 'JUNK'
type Activity = { text: string; time: Date; author: string; type: string; category: 'log' | 'remark' | 'status' }
type Lead = { id: string; name: string; phone: string; status: LeadStatus; assignedTo: string; assignedName: string; createdAt: string; updatedAt: string; followUpAt?: string | null; quotationAmount?: number | null; activities: Activity[]; junkReason?: string; isClaimable: boolean; doNotContact: boolean; isDuplicate: boolean }
type UserOption = { _id: string; name: string; employeeId?: string; email?: string; role: string; active: boolean; officeLatitude?: number | null; officeLongitude?: number | null; officeRadiusMeters?: number }

const columns = [
  { id: 'HOT', label: 'Hot Leads', color: 'rose', dot: '#e64150' },
  { id: 'WARM', label: 'Warm Leads', color: 'amber', dot: '#f39a14' },
  { id: 'COLD', label: 'Cold Leads', color: 'blue', dot: '#2169e9' },
  { id: 'NOT_CONNECTED', label: 'Not Connected', color: 'slate', dot: '#677187' },
  { id: 'NEW', label: 'New Contact', color: 'green', dot: '#16a766' },
] as const
const navItems = [
  { name: 'Dashboard', icon: LayoutDashboard }, { name: 'Leads', icon: Users }, { name: 'Attendance', icon: CalendarCheck2 },
  { name: 'Junk Leads', icon: ShieldAlert }, { name: 'Transfer Requests', icon: ArrowLeftRight },
  { name: 'Lead on Claim', icon: Handshake }, { name: 'Quotations', icon: FileText }, { name: 'Settings', icon: Settings },
]
const validSections = new Set(navItems.map((item) => item.name))
const getSavedSection = () => {
  try {
    const saved = localStorage.getItem('crm:last-section')
    return saved && validSections.has(saved) ? saved : 'Dashboard'
  } catch { return 'Dashboard' }
}
const relativeDate = (date?: string | Date) => {
  if (!date) return 'No activity'
  const hours = Math.floor((Date.now() - new Date(date).getTime()) / 3600000)
  return hours < 1 ? 'Just now' : hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
const fullDate = (date?: string | Date) => date ? new Date(date).toLocaleString() : 'Ã¢â‚¬â€'
const localDateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dateInputValue = (value?: string | null) => value ? localDateValue(new Date(value)) : ''
const timeInputValue = (value?: string | null) => value ? new Date(value).toTimeString().slice(0, 5) : '10:00'
const displayPhoneNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(-10)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(-10)
  return digits.length > 10 ? digits.slice(0, 10) : digits
}
const statusLabel = (status: string) => ({ NEW: 'New Lead', HOT: 'Hot Lead', WARM: 'Warm Lead', COLD: 'Cold Lead', NOT_CONNECTED: 'Not Connected', NOT_INTERESTED: 'Not Interested', JUNK: 'Junk' }[status] || status.replaceAll('_', ' '))
const decodeVapidKey = (key: string) => {
  const base64 = (key + '='.repeat((4 - key.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0))
}
function mapLead(raw: LeadRecord): Lead {
  const activities: Activity[] = [
    ...(raw.activities || []).map((item) => ({ text: item.fromStatus && item.toStatus ? `Status changed: ${statusLabel(item.fromStatus)} → ${statusLabel(item.toStatus)}${item.message ? `. Details: ${item.message}` : ''}` : item.message || item.type.replaceAll('_', ' ').toLowerCase(), time: new Date(item.createdAt), author: 'Sales team', type: item.type, category: item.fromStatus && item.toStatus || ['STATUS_CHANGED', 'MARKED_JUNK', 'RESTORED'].includes(item.type) ? 'status' as const : 'log' as const })),
    ...(raw.remarks || []).map((item) => ({ text: item.message, time: new Date(item.createdAt), author: 'Sales team', type: 'REMARK', category: 'remark' as const })),
  ].sort((a, b) => b.time.getTime() - a.time.getTime())
  return { id: raw._id, name: raw.name, phone: displayPhoneNumber(raw.phone), status: raw.status, assignedTo: typeof raw.assignedTo === 'string' ? raw.assignedTo : raw.assignedTo?._id || '', assignedName: typeof raw.assignedTo === 'string' ? 'Sales team' : raw.assignedTo?.name || 'Claim pool', createdAt: raw.createdAt, updatedAt: raw.updatedAt, followUpAt: raw.followUpAt, quotationAmount: raw.quotationAmount, activities, junkReason: raw.junkReason, isClaimable: raw.isClaimable, doNotContact: raw.doNotContact, isDuplicate: raw.isDuplicate }
}

export default function LeadsPage() {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [page, setPage] = useState(getSavedSection)
  const [search, setSearch] = useState('')
  const [leadSort, setLeadSort] = useState('date-desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('All leads')
  const [modal, setModal] = useState<'lead' | 'actions' | 'transfer' | 'quote' | 'junk' | null>(null)
  const [remark, setRemark] = useState('')
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [mobilePushEnabled, setMobilePushEnabled] = useState(false)
  const pushSetupInProgress = useRef(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dashboardLeadPage, setDashboardLeadPage] = useState(1)
  const navigateSection = (section: string) => {
    setPage(section)
    try { localStorage.setItem('crm:last-section', section) } catch { /* Storage may be disabled. */ }
  }
  useEffect(() => { if (page === 'Attendance' && user && user.role !== 'ADMIN') navigateSection('Dashboard') }, [page, user])

  const leadsQuery = useQuery({ queryKey: ['leads', search, filter, page], queryFn: () => leadsApi.list(search, page === 'Junk Leads' || filter === 'Junk leads' ? 'JUNK' : undefined, filter === 'Claimed Leads' && page === 'Leads') })
  const leads = (leadsQuery.data?.data || []).map(mapLead)
  const selectedLeadQuery = useQuery({ queryKey: ['lead-detail', selectedId], queryFn: () => leadsApi.detail(selectedId as string), enabled: Boolean(selectedId) && !leads.some((lead) => lead.id === selectedId) })
  const selected = selectedId ? leads.find((lead) => lead.id === selectedId) || (selectedLeadQuery.data ? mapLead(selectedLeadQuery.data) : undefined) : undefined
  const claimsQuery = useQuery({ queryKey: ['claims'], queryFn: claimsApi.list, enabled: page === 'Lead on Claim' })
  const transferLeadsQuery = useQuery({ queryKey: ['transfer-leads'], queryFn: () => leadsApi.list(), enabled: page === 'Transfer Requests' })
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.summary, enabled: page === 'Dashboard' })
  const dashboardLeadsQuery = useQuery({ queryKey: ['dashboard-leads', dashboardLeadPage], queryFn: () => dashboardApi.leads(dashboardLeadPage), enabled: page === 'Dashboard' && user?.role === 'ADMIN' })
  const notificationQuery = useQuery({ queryKey: ['notifications'], queryFn: notificationsApi.list, refetchInterval: 30_000 })
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    void navigator.serviceWorker.getRegistration('/').then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription()
      setMobilePushEnabled(Boolean(subscription))
    }).catch(() => undefined)
  }, [])
  const enableMobilePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      toast.error('This browser does not support mobile push notifications', { id: 'mobile-push-unsupported' })
      return
    }
    if (!window.isSecureContext) {
      toast.error('Mobile notifications need a secure HTTPS connection', { id: 'mobile-push-secure-context' })
      return
    }
    if (Notification.permission === 'denied') {
      toast.error('Notifications are blocked. Allow them in your browser settings, then reload this page.', { id: 'mobile-push-permission-denied' })
      return
    }
    if (pushSetupInProgress.current) return
    pushSetupInProgress.current = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error(permission === 'denied' ? 'Notifications are blocked. Allow them in your browser settings, then reload this page.' : 'Allow notifications to receive reminders.', { id: 'mobile-push-permission-denied' })
        return
      }
      const registration = await navigator.serviceWorker.register('/service-worker.js')
      const publicKey = await mobilePushApi.publicKey()
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(publicKey) })
      await mobilePushApi.subscribe(subscription.toJSON())
      setMobilePushEnabled(true)
      toast.success('Mobile reminders are enabled on this device')
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not enable mobile notifications'), { id: 'mobile-push-enable-error' }) }
    finally { pushSetupInProgress.current = false }
  }
  const disableMobilePush = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) { await mobilePushApi.unsubscribe(subscription.endpoint); await subscription.unsubscribe() }
      setMobilePushEnabled(false)
      toast.success('Mobile reminders are disabled on this device')
    } catch (error) { toast.error(apiErrorMessage(error, 'Could not disable mobile notifications')) }
  }
  const seenNotificationIds = useRef(new Set<string>())
  const notificationsLoaded = useRef(false)
  useEffect(() => {
    const items = notificationQuery.data?.data
    if (!items) return
    const unseen = items.filter((item) => !seenNotificationIds.current.has(item._id))
    unseen.forEach((item) => seenNotificationIds.current.add(item._id))
    notificationsLoaded.current = true
  }, [notificationQuery.data])
  const transferRequestsQuery = useQuery({ queryKey: ['transfer-requests'], queryFn: notificationsApi.transfers, enabled: page === 'Transfer Requests', refetchInterval: page === 'Transfer Requests' ? 30_000 : false })
  const quotationQuery = useQuery({ queryKey: ['quotations'], queryFn: async () => (await apiClient.get<{ data: QuotationRecord[] }>('/quotations')).data.data, enabled: page === 'Quotations' })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: async () => (await apiClient.get<{ data: UserOption[] }>('/users')).data.data, enabled: modal === 'transfer' || page === 'Settings' || page === 'Junk Leads' || filter === 'Junk leads' })
  const refreshLeads = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['leads'] }), queryClient.invalidateQueries({ queryKey: ['dashboard'] }), queryClient.invalidateQueries({ queryKey: ['dashboard-leads'] })])
  const reportError = (error: unknown) => toast.error(apiErrorMessage(error))
  const createMutation = useMutation({ mutationFn: leadsApi.create, onSuccess: async (lead) => { await refreshLeads(); setSelectedId(lead._id); setModal(null); toast.success('Lead created') }, onError: reportError })
  const statusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => leadsApi.status(id, status), onSuccess: async (_lead, variables) => { await Promise.all([refreshLeads(), queryClient.invalidateQueries({ queryKey: ['lead-detail', variables.id] }), variables.status === 'NOT_INTERESTED' ? queryClient.invalidateQueries({ queryKey: ['claims'] }) : Promise.resolve()]); if (variables.status === 'NOT_INTERESTED') { setSelectedId(null); navigateSection('Lead on Claim') }; toast.success(variables.status === 'NOT_INTERESTED' ? 'Lead moved to the claim pool' : 'Lead status updated') }, onError: reportError })
  const remarkMutation = useMutation({ mutationFn: ({ id, message }: { id: string; message: string }) => leadsApi.remark(id, message), onSuccess: async () => { await refreshLeads(); setRemark(''); toast.success('Remark added') }, onError: reportError })
  const interactionMutation = useMutation({ mutationFn: ({ id, message }: { id: string; message: string }) => leadsApi.qualifyingActivity(id, message), onSuccess: async () => { await refreshLeads(); toast.success('Customer interaction recorded') }, onError: reportError })
  const transferMutation = useMutation({ mutationFn: ({ id, newOwnerId, reason }: { id: string; newOwnerId: string; reason?: string }) => leadsApi.transfer(id, newOwnerId, reason), onSuccess: async () => { await refreshLeads(); setModal(null); toast.success('Lead transferred') }, onError: reportError })
  const junkMutation = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => leadsApi.markJunk(id, reason), onSuccess: async () => { await refreshLeads(); setModal(null); toast.success('Lead marked as junk') }, onError: reportError })
  const claimMutation = useMutation({ mutationFn: claimsApi.claim, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['claims'] }), refreshLeads()]); setFilter('Claimed Leads'); navigateSection('Leads'); toast.success('Lead claimed') }, onError: reportError })
  const notificationRead = useMutation({ mutationFn: notificationsApi.read, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['notifications'] }), queryClient.invalidateQueries({ queryKey: ['transfer-requests'] })]) }, onError: reportError })
  const logout = useMutation({ mutationFn: authApi.logout, onSuccess: () => { queryClient.clear(); useAuthStore.getState().setUser(null); try { localStorage.removeItem('crm:last-section') } catch { /* Storage may be disabled. */ }; window.location.assign('/login') }, onError: reportError })
  const quoteMutation = useMutation({ mutationFn: leadsApi.createQuotation, onSuccess: async () => { await refreshLeads(); queryClient.invalidateQueries({ queryKey: ['quotations'] }); setModal(null); toast.success('Quotation draft created') }, onError: reportError })
  const quoteStatusMutation = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => apiClient.patch(`/quotations/${id}/status`, { status }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['quotations'] }), refreshLeads()]); toast.success('Quotation status updated') }, onError: reportError })
  const dncMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: boolean }) => leadsApi.doNotContact(id, value), onSuccess: refreshLeads, onError: reportError })
  const followUpMutation = useMutation({ mutationFn: ({ id, followUpAt }: { id: string; followUpAt: string | null }) => leadsApi.scheduleFollowUp(id, followUpAt), onSuccess: async (_result, variables) => { await refreshLeads(); toast.success(variables.followUpAt ? 'Follow-up reminder scheduled' : 'Follow-up reminder cleared') }, onError: reportError })

  const filteredLeads = useMemo(() => leads.filter((lead) => {
    const mine = user && (lead.assignedTo === user.id || user.role === 'ADMIN')
    const stageFilters: Record<string, LeadStatus> = { 'New leads': 'NEW', 'Hot leads': 'HOT', 'Warm leads': 'WARM', 'Cold leads': 'COLD', 'Not connected': 'NOT_CONNECTED', 'Junk leads': 'JUNK' }
    return filter === 'All leads' || filter === 'Claimed Leads' || (filter === 'My leads' && mine) || (stageFilters[filter] ? lead.status === stageFilters[filter] : false)
  }).sort((a, b) => {
    const descending = leadSort.endsWith('desc')
    const comparison = leadSort.startsWith('name') ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return descending ? -comparison : comparison
  }), [filter, leadSort, leads, user])
  const stageColumnIds: Record<string, string> = { 'New leads': 'NEW', 'Hot leads': 'HOT', 'Warm leads': 'WARM', 'Cold leads': 'COLD', 'Not connected': 'NOT_CONNECTED' }
  const boardColumns = filter === 'Claimed Leads' ? [{ id: 'CLAIMED_LEADS', label: 'Claimed Lead', color: 'orange', dot: '#e07822' }] : stageColumnIds[filter] ? columns.filter((column) => column.id === stageColumnIds[filter]) : columns
  const leadsForColumn = (columnId: string) => filter === 'Claimed Leads' ? filteredLeads : filteredLeads.filter((lead) => lead.status === columnId)

  function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    createMutation.mutate({ phone: String(data.get('phone') || '').trim(), name: String(data.get('name') || '').trim() || undefined })
  }
  function addRemark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selected && remark.trim()) remarkMutation.mutate({ id: selected.id, message: remark.trim() })
  }
  function transferLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    transferMutation.mutate({ id: selected.id, newOwnerId: String(data.get('newOwnerId') || ''), reason: String(data.get('reason') || '') || undefined })
  }
  function markJunk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    junkMutation.mutate({ id: selected.id, reason: String(new FormData(event.currentTarget).get('reason') || 'Other') })
  }
  function viewJunkLead(id: string) {
    setFilter('Junk leads')
    setSelectedId(id)
    navigateSection('Leads')
  }
  async function restoreJunkLead(id: string, ownerId: string, status: LeadStatus) {
    try {
      await apiClient.post(`/leads/${id}/restore`, { ownerId, status })
      await refreshLeads()
      toast.success('Lead restored')
    } catch (error) { toast.error(apiErrorMessage(error)) }
  }
  function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const data = new FormData(event.currentTarget)
    quoteMutation.mutate({ leadId: selected.id, amount: Number(data.get('amount') || 0), status: 'DRAFT', customer: {
      instituteName: String(data.get('instituteName') || selected.name), mobile: String(data.get('mobile') || selected.phone),
      billingAddress: String(data.get('billingAddress') || ''), city: String(data.get('city') || ''), state: String(data.get('state') || ''), pincode: String(data.get('pincode') || ''),
    } })
  }

  return <div className={`app-shell ${page === 'Leads' && selected ? 'detail-open' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigateSection('Dashboard') }}><img className="brand-mark" src="/brand-logo.png" alt=""/><span>Elucidate tech</span></a>
      <nav className="side-nav" aria-label="Main navigation">{navItems.filter(({ name }) => name !== 'Attendance' || user?.role === 'ADMIN').map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => { if (name === 'Leads') setSelectedId(null); navigateSection(name) }}><Icon size={19}/><span>{name}</span>{name === 'Lead on Claim' && Boolean(claimsQuery.data?.length) && <span className="nav-badge">{claimsQuery.data?.length}</span>}{name === 'Transfer Requests' && Boolean(notificationQuery.data?.data.some((item) => item.type === 'TRANSFER' && !item.readAt)) && <span className="nav-badge">{notificationQuery.data?.data.filter((item) => item.type === 'TRANSFER' && !item.readAt).length}</span>}</button>)}</nav>
      <div className="sidebar-promo"><ChartNoAxesColumnIncreasing className="promo-chart"/><b>Grow Your Sales</b><span>Track. Manage. Close.</span><button onClick={() => navigateSection('Dashboard')}>LetÃ¢â‚¬â„¢s Do It <MoveRight size={15}/></button></div>
      <div className="sidebar-footer">Lead management workspace</div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <label className="search-box"><Search size={19}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads by name or phone..." aria-label="Search leads"/></label>
        <div className="top-actions"><SelfAttendanceControl userId={user?.id}/><div className="notification-wrap"><button className="bell-button" aria-label="Notifications" onClick={() => setNotificationOpen(!notificationOpen)}><Bell size={21}/>{Boolean(notificationQuery.data?.unread) && <i>{notificationQuery.data?.unread}</i>}</button>
          {notificationOpen && <div className="notification-popover"><div className="popover-head"><b>Notifications</b></div><div style={{ padding: '12px 16px', borderBottom: '1px solid #e8edf5' }}><button className="button button-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void (mobilePushEnabled ? disableMobilePush() : enableMobilePush())}>{mobilePushEnabled ? 'Turn off mobile reminders' : 'Enable mobile reminders'}</button><small style={{ display: 'block', marginTop: 8, color: '#697891', lineHeight: 1.45 }}>Get follow-up alerts in your phone’s notification center. On iPhone, add this CRM to your Home Screen first.</small></div>{notificationQuery.data?.data.map((item) => <button className="notification-row" key={item._id} onClick={() => notificationRead.mutate(item._id)}><span className="notif-dot"/><span>{item.message}<small>{relativeDate(item.createdAt)} · {item.readAt ? 'Read' : 'Mark as read'}</small></span></button>)}{!notificationQuery.data?.data.length && <p className="empty-notifications">You’re all caught up.</p>}</div>}</div>
          <span className="top-divider"/><button className="profile-button" onClick={() => logout.mutate()} title="Sign out"><span className="avatar">{user?.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span className="profile-meta"><b>{user?.name}</b><small>{user?.role === 'ADMIN' ? 'Administrator' : 'Sales Team'}</small></span><LogOut className="profile-logout" size={16}/></button>
        </div>
      </header>
      {page === 'Leads' && <div className={`lead-layout ${selected ? '' : 'drawer-closed'}`}>
        <section className="board-area">
          <div className="page-heading"><div><div className="eyebrow">SALES WORKSPACE Ã‚Â· LEAD MANAGEMENT</div><h1>Manage Leads</h1><p>Organize and track your prospects with ease</p></div><div className="heading-actions"><select className="button button-outline filter-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter leads"><option>All leads</option><option>My leads</option><option>New leads</option><option>Hot leads</option><option>Warm leads</option><option>Cold leads</option><option>Not connected</option><option>Claimed Leads</option><option>Junk leads</option></select><label className="button button-outline sort-control"><ArrowDownUp size={15}/><select className="sort-select" aria-label="Sort leads" value={leadSort} onChange={(event) => setLeadSort(event.target.value)}><option value="name-asc">Name · Ascending (A–Z)</option><option value="name-desc">Name · Descending (Z–A)</option><option value="date-asc">Date · Ascending (Oldest first)</option><option value="date-desc">Date · Descending (Newest first)</option></select></label><button className="button button-primary" onClick={() => setModal('lead')}><Plus size={16}/> Add Lead</button></div></div>
          {leadsQuery.isPending ? <div className="board-state"><span className="loading-spinner"/>Loading leads...</div> : leadsQuery.isError ? <div className="board-state error">Could not load leads. {apiErrorMessage(leadsQuery.error)}</div> : filter === "Junk leads" ? <JunkLeads leads={filteredLeads} users={usersQuery.data || []} isAdmin={user?.role === "ADMIN"} onRestore={restoreJunkLead} onView={viewJunkLead} /> : <div className="board-scroll"><div className="kanban-board">{boardColumns.map((column) => <section className={`kanban-column ${column.color}`} key={column.id} onDragOver={(event) => { if (filter !== "Claimed Leads") event.preventDefault() }} onDrop={() => { if (filter !== "Claimed Leads" && draggingId) statusMutation.mutate({ id: draggingId, status: column.id as LeadStatus }); setDraggingId(null) }}>
            <header className="column-header"><div><span className="stage-dot" style={{ background: column.dot }}/><b>{column.label}</b></div><span className="column-count">{leadsForColumn(column.id).length}</span></header>
            <div className="lead-list">{leadsForColumn(column.id).map((lead) => <LeadCard key={lead.id} lead={lead} selected={selectedId === lead.id} onSelect={() => setSelectedId(lead.id)} onDrag={() => setDraggingId(lead.id)} draggable={filter !== 'Claimed Leads'} onMenu={() => { setSelectedId(lead.id); setModal('actions') }}/>)}</div>
            {!leadsForColumn(column.id).length && <div className="column-empty">{filter === 'Claimed Leads' ? 'No leads claimed yet' : 'No leads in this stage'}</div>}
            <button className="add-column-lead" onClick={() => setModal('lead')}><Plus size={15}/> Add Lead</button>
          </section>)}</div></div>}
          <div className="board-footer"><span>Showing <b>{filteredLeads.length}</b> of <b>{leads.length}</b> leads</span><span>Drag a card to update status</span></div>
        </section>
        {selected && <LeadDetails lead={selected} remark={remark} setRemark={setRemark} onClose={() => setSelectedId(null)} onRemark={addRemark} onQualifyingActivity={(message) => interactionMutation.mutate({ id: selected.id, message })} onScheduleFollowUp={(followUpAt) => followUpMutation.mutate({ id: selected.id, followUpAt })} followUpPending={followUpMutation.isPending} onChangeStatus={(status) => statusMutation.mutate({ id: selected.id, status })} statusPending={statusMutation.isPending} onTransfer={() => setModal('transfer')} onQuote={() => setModal('quote')} onDnc={() => dncMutation.mutate({ id: selected.id, value: !selected.doNotContact })} onJunk={() => setModal('junk')} onNotInterested={() => statusMutation.mutate({ id: selected.id, status: 'NOT_INTERESTED' })}/>}
      </div>}
      {page === 'Junk Leads' && <section className="other-page"><div className="page-heading"><div><div className="eyebrow">LEAD QUALITY</div><h1>Junk Leads</h1><p>Review junk leads and their details{leadsQuery.data ? ` · ${leadsQuery.data.pagination.total} total` : ''}</p></div></div>{leadsQuery.isPending ? <div className="board-state"><span className="loading-spinner"/>Loading junk leads...</div> : leadsQuery.isError ? <div className="board-state error">Could not load junk leads. {apiErrorMessage(leadsQuery.error)}</div> : <JunkLeads leads={leads} users={usersQuery.data || []} isAdmin={user?.role === 'ADMIN'} onRestore={restoreJunkLead} onView={viewJunkLead}/>}</section>}
      {page === 'Transfer Requests' && <TransferRequestsPage requests={transferRequestsQuery.data || []} leads={(transferLeadsQuery.data?.data || []).map(mapLead)} loading={transferRequestsQuery.isPending || transferLeadsQuery.isPending} error={transferRequestsQuery.isError || transferLeadsQuery.isError} onRefresh={() => { void transferRequestsQuery.refetch(); void transferLeadsQuery.refetch() }} onView={(id) => { setFilter('All leads'); setSelectedId(id); navigateSection('Leads') }} onMarkRead={(id) => notificationRead.mutate(id)}/>}
      {page === 'Dashboard' && <DashboardPage data={dashboardQuery.data} loading={dashboardQuery.isPending} leads={leads} admin={user?.role === 'ADMIN'} adminLeads={dashboardLeadsQuery.data} adminLeadsLoading={dashboardLeadsQuery.isPending} adminPage={dashboardLeadPage} onAdminPage={setDashboardLeadPage} onAdd={() => setModal('lead')} onLeads={() => navigateSection('Leads')} onClaims={() => navigateSection('Lead on Claim')} onSelect={(id) => { setSelectedId(id); navigateSection('Leads') }}/ >}
      {page === 'Attendance' && user?.role === 'ADMIN' && <AttendancePage />}
      {page === 'Lead on Claim' && <ClaimsPage leads={claimsQuery.data || []} loading={claimsQuery.isPending} error={claimsQuery.isError} refreshing={claimsQuery.isFetching} onRefresh={() => claimsQuery.refetch()} onClaim={(id) => claimMutation.mutate(id)} pending={claimMutation.isPending}/ >}
      {page === 'Quotations' && <QuotationsPage rows={quotationQuery.data || []} loading={quotationQuery.isPending} error={quotationQuery.isError} onStatus={(id, status) => quoteStatusMutation.mutate({ id, status })}/ >}
      {page === 'Settings' && <SettingsPage
        users={usersQuery.data || []}
        loading={usersQuery.isPending}
        onCreate={async (event) => {
          event.preventDefault()
          const formElement = event.currentTarget
          const form = new FormData(formElement)
          try {
            const office = await getOfficeLocation(form)
            const response = await apiClient.post('/users', { name: form.get('name'), employeeId: form.get('employeeId'), email: form.get('email'), password: form.get('password'), role: 'SALESPERSON', ...office, officeRadiusMeters: Number(form.get('officeRadiusMeters')) })
            await queryClient.invalidateQueries({ queryKey: ['users'] })
            toast.success('Employee ' + response.data.data.employeeId + ' created')
            formElement.reset()
          } catch (error) { toast.error(error instanceof Error ? error.message : apiErrorMessage(error)) }
        }}
        onToggle={async (id, active) => {
          try {
            await apiClient.patch(`/users/${id}`, { active })
            await queryClient.invalidateQueries({ queryKey: ['users'] })
            toast.success('Account updated')
          } catch (error) { toast.error(error instanceof Error ? error.message : apiErrorMessage(error)) }
        }}
        onSaveLocation={async (event, id) => {
          event.preventDefault()
          const formElement = event.currentTarget
          const form = new FormData(formElement)
          try {
            const office = await getOfficeLocation(form)
            await apiClient.patch(`/users/${id}`, { ...office, officeRadiusMeters: Number(form.get('officeRadiusMeters')) })
            await queryClient.invalidateQueries({ queryKey: ['users'] })
            toast.success('Employee office location updated')
          } catch (error) { toast.error(error instanceof Error ? error.message : apiErrorMessage(error)) }
        }}
        onChangePin={async (event) => {
          event.preventDefault()
          const formElement = event.currentTarget
          const form = new FormData(formElement)
          const currentPin = String(form.get('currentPin') || '')
          const newPin = String(form.get('newPin') || '')
          if (newPin !== String(form.get('confirmPin') || '')) { toast.error('The new PIN entries do not match.'); return }
          try {
            await apiClient.post('/auth/change-pin', { currentPin, newPin })
            formElement.reset()
            toast.success('Your PIN has been changed')
          } catch (error) { toast.error(apiErrorMessage(error)) }
        }}
        onResetPin={async (event, id) => {
          event.preventDefault()
          const formElement = event.currentTarget
          const form = new FormData(formElement)
          try {
            await apiClient.post(`/users/${id}/reset-pin`, { newPin: form.get('newPin') })
            formElement.reset()
            toast.success('Employee PIN reset. They can now sign in with the new PIN.')
          } catch (error) { toast.error(apiErrorMessage(error)) }
        }}
      />}
    </main>
    {modal && <LeadModal modal={modal} lead={selected} users={usersQuery.data || []} onClose={() => setModal(null)} onCreate={createLead} onTransfer={transferLead} onQuote={createQuote} onJunk={markJunk} onChooseTransfer={() => setModal('transfer')} onChooseQuote={() => setModal('quote')} onChooseJunk={() => setModal('junk')} onNotInterested={() => { if (selected) statusMutation.mutate({ id: selected.id, status: 'NOT_INTERESTED' }); setModal(null) }} onChangeStatus={(status) => { if (selected) statusMutation.mutate({ id: selected.id, status }); setModal(null) }} creating={createMutation.isPending || transferMutation.isPending || quoteMutation.isPending || junkMutation.isPending}/>}
  </div>
}

function LeadCard({ lead, selected, onSelect, onDrag, onMenu, draggable = true }: { lead: Lead; selected: boolean; onSelect: () => void; onDrag: () => void; onMenu: () => void; draggable?: boolean }) {
  const column = columns.find((item) => item.id === lead.status)
  return <article className={`lead-card ${selected ? 'chosen' : ''}`} draggable={draggable} onDragStart={draggable ? onDrag : undefined} onClick={onSelect}>
    <button className="card-menu" aria-label={`Actions for ${lead.name}`} onClick={(event) => { event.stopPropagation(); onMenu() }}><MoreVertical size={17}/></button>
    <h3>{lead.name}</h3><a className="phone-link" href={`tel:${lead.phone}`} onClick={(event) => event.stopPropagation()}><Phone size={12}/>{lead.phone}</a>
    <div className="card-tags"><span className={`lead-tag ${column?.color || 'slate'}`}>{lead.status === 'NEW' ? 'New' : lead.status.replaceAll('_', ' ')}</span>{lead.isDuplicate && <span className="duplicate-badge">Duplicate</span>}</div>
    <div className="card-time"><Clock3 size={12}/>{relativeDate(lead.activities[0]?.time || lead.updatedAt)}</div>
    {lead.followUpAt && <div className="card-info follow-up-info" title={`Scheduled follow-up: ${new Date(lead.followUpAt).toLocaleString()}`}><Clock3 size={12}/><span>Follow-up</span><b>{new Date(lead.followUpAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b></div>}
    {lead.quotationAmount != null && <div className="card-info quotation-info" title="Latest quotation amount"><FileText size={12}/><span>Quotation</span><b>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(lead.quotationAmount)}</b></div>}
  </article>
}

function LeadDetails({ lead, remark, setRemark, onClose, onRemark, onQualifyingActivity, onScheduleFollowUp, followUpPending, onChangeStatus, statusPending, onTransfer, onQuote, onDnc, onJunk, onNotInterested }: { lead: Lead; remark: string; setRemark: (value: string) => void; onClose: () => void; onRemark: (event: FormEvent<HTMLFormElement>) => void; onQualifyingActivity: (message: string) => void; onScheduleFollowUp: (followUpAt: string | null) => void; followUpPending: boolean; onChangeStatus: (status: LeadStatus) => void; statusPending: boolean; onTransfer: () => void; onQuote: () => void; onDnc: () => void; onJunk: () => void; onNotInterested: () => void }) {
  const [interaction, setInteraction] = useState('')
  const [followUpDate, setFollowUpDate] = useState(() => dateInputValue(lead.followUpAt))
  const [followUpTime, setFollowUpTime] = useState(() => timeInputValue(lead.followUpAt))
  const [activityFilter, setActivityFilter] = useState<'all' | 'log' | 'remark' | 'status'>('all')
  const filteredActivities = lead.activities.filter((activity) => activityFilter === 'all' || activity.category === activityFilter)
  const stage = columns.find((column) => column.id === lead.status)
  const stageColor = stage?.color || (lead.status === 'NOT_INTERESTED' ? 'orange' : lead.status === 'JUNK' ? 'rose' : 'slate')
  useEffect(() => { setFollowUpDate(dateInputValue(lead.followUpAt)); setFollowUpTime(timeInputValue(lead.followUpAt)) }, [lead.id, lead.followUpAt])
  function scheduleFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const due = new Date(`${followUpDate}T${followUpTime}`)
    if (!followUpDate || !followUpTime || Number.isNaN(due.getTime()) || due <= new Date()) { toast.error('Choose a future date and time'); return }
    onScheduleFollowUp(due.toISOString())
  }
  function chooseFollowUpDay(offset: number) {
    const date = new Date()
    date.setDate(date.getDate() + offset)
    setFollowUpDate(localDateValue(date))
  }
  return <aside className="detail-panel"><button className="close-panel" onClick={onClose} aria-label="Close details"><X size={19}/></button>
    <div className="detail-person"><span className={`lead-tag ${stageColor}`}>{stage?.label || statusLabel(lead.status)}</span><h2>{lead.name}</h2><div className="detail-contact"><a href={`tel:${lead.phone}`} aria-label={`Call ${lead.name}`} title="Call lead"><Phone size={17}/></a><span className="contact-number">{lead.phone}</span><a className="whatsapp" target="_blank" rel="noreferrer" href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} aria-label={`Message ${lead.name} on WhatsApp`} title="Open WhatsApp"><MessageCircle size={17}/></a></div></div>
     <section className="detail-section"><h3>Lead Details</h3><dl className="detail-list"><div><dt>Stage</dt><dd><span className="mini-dot" style={{ background: stage?.dot || '#65718a' }}/>{stage?.label || lead.status}</dd></div><div><dt>Change status</dt><dd><select className="detail-status-select" aria-label={`Change status for ${lead.name}`} value={lead.status} disabled={statusPending} onChange={(event) => onChangeStatus(event.target.value as LeadStatus)}>{columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}<option value="NOT_INTERESTED">Not Interested</option></select></dd></div><div><dt>Added On</dt><dd>{fullDate(lead.createdAt)}</dd></div><div><dt>Assigned To</dt><dd><span className="mini-avatar">{lead.assignedName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>{lead.assignedName}</dd></div><div><dt>Do not contact</dt><dd><button className={`dnc-toggle ${lead.doNotContact ? 'enabled' : ''}`} onClick={onDnc}>{lead.doNotContact ? 'On' : 'Off'}</button></dd></div></dl><div className="detail-actions"><button onClick={onTransfer}><ArrowLeftRight size={13}/>Transfer</button><button onClick={onQuote}><Plus size={13}/>Quotation</button></div><div className="detail-actions"><button onClick={onNotInterested}>Not Interested</button><button onClick={onJunk}><ShieldAlert size={13}/>Mark Junk</button></div></section>
    <form className="followup-form" onSubmit={scheduleFollowUp}>
      <div className="followup-title"><h3>Schedule follow-up</h3><span>{lead.followUpAt ? 'Scheduled' : 'No reminder'}</span></div>
      <p>{lead.followUpAt ? `Current reminder: ${fullDate(lead.followUpAt)}` : 'Get a reminder when it is time to follow up.'}</p>
      <div className="followup-shortcuts"><button type="button" onClick={() => chooseFollowUpDay(0)}>Today</button><button type="button" onClick={() => chooseFollowUpDay(1)}>Tomorrow</button></div>
      <div className="followup-fields"><label>Date<input type="date" value={followUpDate} min={localDateValue(new Date())} onChange={(event) => setFollowUpDate(event.target.value)} required/></label><label>Time<input type="time" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)} required/></label></div>
      <div className="followup-actions"><button className="button button-primary" disabled={followUpPending}>{followUpPending ? 'Saving...' : 'Save reminder'}</button>{lead.followUpAt && <button type="button" className="button button-outline" disabled={followUpPending} onClick={() => onScheduleFollowUp(null)}>Clear</button>}</div>
    </form>
    <form className="remark-form" onSubmit={onRemark}><h3>Add Remark</h3><textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="Add a note to the activity history" required/><div className="remark-submit"><button className="button button-primary">Add Remark</button></div></form>
    <form className="remark-form interaction-form" onSubmit={(event) => { event.preventDefault(); if (interaction.trim()) { onQualifyingActivity(interaction.trim()); setInteraction('') } }}><h3>Log customer interaction</h3><textarea value={interaction} onChange={(event) => setInteraction(event.target.value)} placeholder="Record a completed follow-up and outcome" required/><div className="remark-submit"><button className="button button-outline">Save interaction</button></div><small>Only documented customer interactions reset the claim inactivity timer.</small></form>
    <section className="timeline-section">
      <h3>Activity History <span>{filteredActivities.length}</span></h3>
      <div className="activity-filters" role="group" aria-label="Filter activity history">
        {([{ label: 'All', value: 'all' }, { label: 'Logs', value: 'log' }, { label: 'Remarks', value: 'remark' }, { label: 'Status', value: 'status' }] as const).map((option) => <button type="button" key={option.value} className={`activity-filter ${activityFilter === option.value ? 'active' : ''}`} aria-pressed={activityFilter === option.value} onClick={() => setActivityFilter(option.value)}>{option.label}</button>)}
      </div>
      <div className="timeline">
        {filteredActivities.map((item, index) => <article className="timeline-entry" key={`${item.time.toISOString()}-${index}`}><span className={`timeline-dot ${item.type === 'QUOTATION_CREATED' ? 'quote' : item.type === 'CREATED' ? 'created' : item.category === 'status' ? 'status' : ''}`}/><time>{fullDate(item.time)}</time><p>{item.text}</p><small>{item.author}</small></article>)}
        {!filteredActivities.length && <p className="empty-copy">{activityFilter === 'all' ? 'No activity has been recorded.' : `No ${activityFilter} entries have been recorded.`}</p>}
      </div>
    </section>
  </aside>
}

function SelfAttendanceControl({ userId }: { userId?: string }) {
  const queryClient = useQueryClient()
  const date = localDateValue(new Date())
  const attendance = useQuery({ queryKey: ['my-attendance', userId, date], queryFn: () => attendanceApi.mine(date), enabled: Boolean(userId), refetchInterval: 60_000 })
  const punch = useMutation({
    mutationFn: async (action: 'in' | 'out') => {
      if (!navigator.geolocation) throw new Error('This browser does not support location access.')
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? 'Allow location access in your browser to punch in or out.' : error.code === error.TIMEOUT ? 'Could not get your location in time. Try again.' : 'Your location is unavailable. Check your device location settings.')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }))
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }
      return action === 'in' ? attendanceApi.punchIn(date, location) : attendanceApi.punchOut(date, location)
    },
    onSuccess: async (record, action) => { queryClient.setQueryData(['my-attendance', userId, date], record); await queryClient.invalidateQueries({ queryKey: ['attendance', date] }); toast.success(action === 'in' ? 'You are punched in' : 'You are punched out') },
    onError: reportAttendanceError,
  })
  const record = attendance.data
  const isPunchedIn = Boolean(record?.checkInAt || record?.checkIn)
  const isPunchedOut = Boolean(record?.checkOutAt || record?.checkOut)
  const complete = isPunchedIn && isPunchedOut
  const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  if (!userId) return null
  return <div className={`attendance-punch ${complete ? 'is-complete' : ''}`}>
    {complete ? <span title={`In ${time(record?.checkInAt)} · Out ${time(record?.checkOutAt)}`}><CalendarCheck2 size={15}/><span>Attendance done</span></span> : <button className="attendance-punch-button" disabled={attendance.isPending || punch.isPending} onClick={() => punch.mutate(isPunchedIn ? 'out' : 'in')} title={isPunchedIn ? 'Punch out for today' : 'Punch in for today'}><Clock3 size={15}/><span>{punch.isPending ? 'Getting location…' : isPunchedIn ? 'Punch out' : 'Punch in'}</span></button>}
    {isPunchedIn && !complete && <small>In at {time(record?.checkInAt)}</small>}
  </div>
}

function AttendancePage() {
  const queryClient = useQueryClient()
  const [date, setDate] = useState(() => localDateValue(new Date()))
  const [drafts, setDrafts] = useState<Record<string, { status: AttendanceStatus | ''; checkIn: string; checkOut: string; note: string }>>({})
  const attendance = useQuery({ queryKey: ['attendance', date], queryFn: () => attendanceApi.list(date) })
  useEffect(() => {
    if (!attendance.data) return
    setDrafts(Object.fromEntries(attendance.data.map((employee) => [employee._id, {
      status: employee.attendance?.status || '', checkIn: employee.attendance?.checkIn || (employee.attendance?.checkInAt ? timeInputValue(employee.attendance.checkInAt) : ''), checkOut: employee.attendance?.checkOut || (employee.attendance?.checkOutAt ? timeInputValue(employee.attendance.checkOutAt) : ''), note: employee.attendance?.note || '',
    }])))
  }, [attendance.data])
  const save = useMutation({
    mutationFn: ({ userId, values }: { userId: string; values: { status: AttendanceStatus; checkIn: string; checkOut: string; note: string } }) => attendanceApi.save(userId, { date, ...values }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['attendance', date] }); toast.success('Attendance saved') },
    onError: reportAttendanceError,
  })
  const records = attendance.data || []
  const marked = records.filter((employee) => employee.attendance)
  const count = (status: AttendanceStatus) => marked.filter((employee) => employee.attendance?.status === status).length
  const update = (id: string, field: 'status' | 'checkIn' | 'checkOut' | 'note', value: string) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] || { status: '', checkIn: '', checkOut: '', note: '' }), [field]: value } }))
  return <section className="other-page attendance-page">
    <div className="page-heading"><div><div className="eyebrow">ADMINISTRATION · TEAM MANAGEMENT</div><h1>Employee Attendance</h1><p>Review and record your sales team’s daily attendance.</p></div><label className="attendance-date">Attendance date<input type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label></div>
    <div className="attendance-summary"><article><small>Employees</small><b>{attendance.isPending ? '—' : records.length}</b></article><article><small>Present</small><b>{count('PRESENT')}</b></article><article><small>Absent</small><b>{count('ABSENT')}</b></article><article><small>Late</small><b>{count('LATE')}</b></article><article><small>Half day</small><b>{count('HALF_DAY')}</b></article><article><small>Leave</small><b>{count('LEAVE')}</b></article><article><small>Not marked</small><b>{Math.max(0, records.length - marked.length)}</b></article></div>
    {attendance.isPending ? <div className="board-state"><span className="loading-spinner"/>Loading attendance...</div> : attendance.isError ? <div className="board-state error">Could not load attendance records.</div> : <div className="attendance-table-wrap"><table className="attendance-table"><thead><tr><th>Employee</th><th>Status</th><th>Check in</th><th>Check out</th><th>Note</th><th>Action</th></tr></thead><tbody>{records.map((employee) => {
      const draft = drafts[employee._id] || { status: '', checkIn: '', checkOut: '', note: '' }
      return <tr key={employee._id}><td><b>{employee.name}</b><small>{employee.employeeId || employee.email}</small></td><td><select aria-label={`Attendance status for ${employee.name}`} value={draft.status} onChange={(event) => update(employee._id, 'status', event.target.value)}><option value="">Not marked</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="LATE">Late</option><option value="HALF_DAY">Half day</option><option value="LEAVE">Leave</option></select></td><td><input aria-label={`Check-in time for ${employee.name}`} type="time" value={draft.checkIn} onChange={(event) => update(employee._id, 'checkIn', event.target.value)} disabled={draft.status === 'ABSENT' || draft.status === 'LEAVE'}/></td><td><input aria-label={`Check-out time for ${employee.name}`} type="time" value={draft.checkOut} onChange={(event) => update(employee._id, 'checkOut', event.target.value)} disabled={draft.status === 'ABSENT' || draft.status === 'LEAVE'}/></td><td><input aria-label={`Attendance note for ${employee.name}`} value={draft.note} onChange={(event) => update(employee._id, 'note', event.target.value)} placeholder="Optional note" maxLength={500}/></td><td><button className="button button-primary attendance-save" disabled={!draft.status || save.isPending} onClick={() => save.mutate({ userId: employee._id, values: { ...draft, status: draft.status as AttendanceStatus } })}>{save.isPending && save.variables?.userId === employee._id ? 'Saving…' : 'Save'}</button></td></tr>
    })}</tbody></table>{records.length === 0 && <div className="attendance-empty">No active sales employees found.</div>}</div>}
    <p className="attendance-footnote">Records are saved per employee and date. Changing the date lets you review or update another day.</p>
  </section>
}

function reportAttendanceError(error: unknown) { toast.error(apiErrorMessage(error, 'Could not save attendance. Please try again.')) }

function DashboardPage({ data, loading, leads, admin, adminLeads, adminLeadsLoading, adminPage, onAdminPage, onAdd, onLeads, onClaims, onSelect }: { data?: DashboardSummary; loading: boolean; leads: Lead[]; admin: boolean; adminLeads?: { data: LeadRecord[]; pagination: { page: number; pages: number; total: number } }; adminLeadsLoading: boolean; adminPage: number; onAdminPage: (page: number) => void; onAdd: () => void; onLeads: () => void; onClaims: () => void; onSelect: (id: string) => void }) {
  const values: Array<[string, number | undefined, string, string]> = [[admin ? 'Team Total Leads' : 'My Total Leads', data?.total, admin ? 'Across all sales team members' : 'In your active pipeline', 'blue'], ['New Leads', data?.statuses.NEW, 'Ready for first contact', 'green'], ['Hot Leads', data?.statuses.HOT, 'Prioritize follow-up', 'rose'], ['Warm Leads', data?.statuses.WARM, 'In progress', 'amber'], ['Cold Leads', data?.statuses.COLD, 'Nurture prospects', 'blue'], ['Not Connected', data?.statuses.NOT_CONNECTED, 'Try another time', 'slate'], ['Not Interested', data?.statuses.NOT_INTERESTED, 'In cooling-off period', 'orange'], ['Available to Claim', data?.availableToClaim, 'Shared claim pool', 'purple'], ['My Claimed Leads', data?.myClaimed, 'Claimed by you', 'green'], ['Follow-ups Due', data?.followUpsDue, 'Need attention', 'orange']]
  return <section className="other-page"><div className="page-heading"><div><div className="eyebrow">{admin ? 'ADMINISTRATION' : 'SALES WORKSPACE'}</div><h1>{admin ? 'Admin Dashboard' : 'Dashboard'}</h1><p>{admin ? 'Team-wide lead pipeline and activity' : 'Your lead activity at a glance'}</p></div><button className="button button-primary" onClick={onAdd}><Plus size={15}/>Add Lead</button></div>
    <div className="metric-grid">{values.map(([label, value, note, color]) => <article className="metric-card" key={label}><span className={`metric-icon ${color}`}><ChartNoAxesColumnIncreasing size={17}/></span><span className="metric-label">{label}</span><b>{loading ? 'â€”' : value ?? 0}</b><small>{note}</small></article>)}</div>
    {admin && <section className="dashboard-panel admin-lead-panel"><div className="panel-title"><div><h2>All Team Leads</h2><p>{adminLeads?.pagination.total ?? 0} leads across the sales team</p></div></div><div className="admin-lead-table-wrap"><table className="admin-lead-table"><thead><tr><th>Lead</th><th>Phone</th><th>Status</th><th>Assigned Employee</th><th>Last Updated</th></tr></thead><tbody>{adminLeadsLoading ? <tr><td colSpan={5}>Loading team leadsâ€¦</td></tr> : adminLeads?.data.map((record) => { const lead = mapLead(record); const owner = record.assignedTo; const ownerName = typeof owner === 'string' ? owner : owner?.name; const employeeId = typeof owner === 'string' ? undefined : owner?.employeeId; return <tr key={lead.id} onClick={() => onSelect(lead.id)}><td>{lead.name}</td><td>{lead.phone}</td><td><span className={`lead-tag ${columns.find((column) => column.id === lead.status)?.color || 'slate'}`}>{lead.status.replaceAll('_', ' ')}</span>{lead.isDuplicate && <span className="duplicate-badge">Duplicate</span>}</td><td>{ownerName ? `${ownerName}${employeeId ? ` (${employeeId})` : ''}` : 'Unassigned'}</td><td>{fullDate(lead.updatedAt)}</td></tr> })}{!adminLeadsLoading && !adminLeads?.data.length && <tr><td colSpan={5}>No leads found.</td></tr>}</tbody></table></div><div className="admin-lead-pagination"><span>Page {adminLeads?.pagination.page ?? 1} of {Math.max(1, adminLeads?.pagination.pages ?? 1)}</span><div><button className="button button-outline" disabled={adminPage <= 1} onClick={() => onAdminPage(adminPage - 1)}>Previous</button><button className="button button-outline" disabled={adminPage >= (adminLeads?.pagination.pages ?? 1)} onClick={() => onAdminPage(adminPage + 1)}>Next</button></div></div></section>}
    <div className="dashboard-bottom"><section className="dashboard-panel"><div className="panel-title"><div><h2>Recent Leads</h2><p>Latest prospect activity</p></div><button onClick={onLeads}>View all â†’</button></div>{leads.slice(0, 5).map((lead) => <button className="recent-lead" key={lead.id} onClick={() => onSelect(lead.id)}><span className="mini-avatar">{lead.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{lead.name}</b><small>{lead.phone}</small></span><span className={`lead-tag ${columns.find((column) => column.id === lead.status)?.color || 'slate'}`}>{lead.status}</span></button>)}</section><section className="dashboard-panel claim-promo"><Handshake className="claim-icon"/><h2>Lead on Claim</h2><p>Claim inactive leads from the shared pool and grow your pipeline.</p><div className="claim-number">{data?.availableToClaim ?? 'â€”'} <small>leads available</small></div><button className="button button-primary" onClick={onClaims}>Browse claimable leads â†’</button></section></div>
  </section>
}
function ClaimsPage({ leads, loading, error, refreshing, onRefresh, onClaim, pending }: { leads: ClaimLead[]; loading: boolean; error: boolean; refreshing: boolean; onRefresh: () => void; onClaim: (id: string) => void; pending: boolean }) {
  return (
    <section className="other-page">
      <div className="page-heading">
        <div><div className="eyebrow">SHARED LEAD POOL</div><h1>Lead on Claim</h1><p>Available leads that meet the inactivity rules</p></div>
        <button className="button button-outline" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
      </div>
      <div className="dashboard-panel empty-page"><div className="claim-list">
        {loading && <p>Loading claimable leads...</p>}
        {error && <div className="empty-copy"><p>Could not load claimable leads. Check the API connection and try again.</p><button className="button button-outline" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Try again'}</button></div>}
        {!loading && leads.map((lead) => <article key={lead._id}><span className="mini-avatar">{lead.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><b>{lead.name}</b><small>{displayPhoneNumber(lead.phone)} · {lead.status.replaceAll('_', ' ')} · eligible {fullDate(lead.claimEligibleAt)}</small></div><button className="button button-primary" disabled={pending} onClick={() => onClaim(lead._id)}>Claim Lead</button></article>)}
        {!loading && !error && !leads.length && <p className="empty-copy">No leads are currently available to claim.</p>}
      </div></div>
    </section>
  )
}

function TransferRequestsPage({ requests, leads, loading, error, onRefresh, onView, onMarkRead }: { requests: NotificationItem[]; leads: Lead[]; loading: boolean; error: boolean; onRefresh: () => void; onView: (id: string) => void; onMarkRead: (id: string) => void }) {
  return <section className="other-page"><div className="page-heading"><div><div className="eyebrow">INCOMING LEADS</div><h1>Transfer Requests</h1><p>Leads teammates have transferred to you</p></div><button className="button button-outline" onClick={onRefresh}>Refresh</button></div>
    {loading ? <div className="board-state"><span className="loading-spinner"/>Loading transfer requests...</div> : error ? <div className="board-state error">Could not load transfer requests. Check the API connection and retry.<button className="button button-outline" onClick={onRefresh}>Try again</button></div> : requests.length ? <div className="dashboard-panel transfer-request-list">{requests.map((request) => {
      const lead = leads.find((item) => item.id === request.leadId)
      return <article className={`transfer-request ${request.readAt ? '' : 'unread'}`} key={request._id}><span className="transfer-request-icon"><ArrowLeftRight size={17}/></span><div className="transfer-request-info"><div className="transfer-request-title"><b>{lead?.name || 'Transferred lead'}</b>{!request.readAt && <span className="unread-label">New</span>}</div><p>{request.message}</p><small>{lead ? `${lead.phone} · ${statusLabel(lead.status)}` : 'Lead details are no longer available'} · {fullDate(request.createdAt)}</small></div><div className="transfer-request-actions">{lead && <button className="button button-primary" onClick={() => onView(lead.id)}>Open lead</button>}{!request.readAt && <button className="button button-outline" onClick={() => onMarkRead(request._id)}>Mark read</button>}</div></article>
    })}</div> : <div className="dashboard-panel transfer-empty"><ArrowLeftRight size={26}/><h2>No transfer requests yet</h2><p>When a teammate transfers a lead to you, the lead and transfer details will appear here.</p></div>}
  </section>
}

interface QuotationRecord { _id: string; number: string; leadId: string; amount: number; status: string; date: string; customer: { instituteName: string; mobile: string } }
function QuotationsPage({ rows, loading, error, onStatus }: { rows: QuotationRecord[]; loading: boolean; error: boolean; onStatus: (id: string, status: string) => void }) {
  return <section className="other-page"><div className="page-heading"><div><div className="eyebrow">CUSTOMER DOCUMENTS</div><h1>Quotations</h1><p>Quotations linked to your leads</p></div></div><div className="dashboard-panel quotation-list">{loading ? <p>Loading quotations...</p> : error ? <p>Could not load quotations.</p> : rows.length ? rows.map((quote) => <article key={quote._id}><FileText size={19}/><div><b>{quote.number || "Quotation"}</b><small>{quote.customer?.instituteName || "Customer"} Â· {quote.customer?.mobile || ""}</small></div><select aria-label={`Status for ${quote.number}`} value={quote.status} onChange={(event) => onStatus(quote._id, event.target.value)}>{["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].map((status) => <option key={status}>{status}</option>)}</select><b>â‚¹{quote.amount.toLocaleString("en-IN")}</b></article>) : <div className="empty-page"><FileText size={30}/><h2>No quotations yet</h2><p>Create a quotation from a lead details panel.</p></div>}</div></section>
}

async function getOfficeLocation(form: FormData): Promise<{ officeLatitude: number; officeLongitude: number }> {
  const mapUrl = String(form.get('officeMapUrl') || '').trim()
  if (mapUrl) {
    const response = await apiClient.post<{ data: { latitude: number; longitude: number } }>('/office-location/resolve', { url: mapUrl })
    return { officeLatitude: response.data.data.latitude, officeLongitude: response.data.data.longitude }
  }
  const latitude = String(form.get('officeLatitude') || '').trim()
  const longitude = String(form.get('officeLongitude') || '').trim()
  if (!latitude || !longitude) throw new Error('Paste a Google Maps pin link to set the office location.')
  return { officeLatitude: Number(latitude), officeLongitude: Number(longitude) }
}

function SettingsPage({ users, loading, onCreate, onToggle, onSaveLocation, onChangePin, onResetPin }: { users: UserOption[]; loading: boolean; onCreate: (event: FormEvent<HTMLFormElement>) => void; onToggle: (id: string, active: boolean) => void; onSaveLocation: (event: FormEvent<HTMLFormElement>, id: string) => void; onChangePin: (event: FormEvent<HTMLFormElement>) => void; onResetPin: (event: FormEvent<HTMLFormElement>, id: string) => void }) {
  const user = useAuthStore((state) => state.user)
  return <section className="other-page">
    <div className="page-heading"><div><div className="eyebrow">WORKSPACE ADMINISTRATION</div><h1>Settings</h1><p>Change your PIN and manage account access and office locations.</p></div></div>
    <form className="dashboard-panel create-user-form pin-change-form" onSubmit={onChangePin}>
      <h2>Change your PIN</h2><p>Use your current PIN to set a new six-digit PIN.</p>
      <div className="form-row"><label>Current PIN<input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" minLength={6} required/></label><label>New 6-digit PIN<input name="newPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={6} pattern="[0-9]{6}" required/></label><label>Confirm new PIN<input name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={6} pattern="[0-9]{6}" required/></label></div>
      <button className="button button-primary">Change PIN</button>
    </form>
    {user?.role === 'ADMIN' ? <div className="settings-grid">
      <form className="dashboard-panel create-user-form" onSubmit={onCreate}><h2>Create salesperson</h2><label>Name<input name="name" required/></label><label>Employee ID<input name="employeeId" placeholder="e.g. EMP-001" required/></label><label>Work email <span className="optional">Optional</span><input name="email" type="email"/></label><label>Initial 6-digit PIN<input name="password" type="password" inputMode="numeric" minLength={6} maxLength={6} pattern="[0-9]{6}" required/></label><h3>Assigned office location</h3><p>Paste the Google Maps pin link. Coordinates are extracted when you save.</p><label>Google Maps pin link<input name="officeMapUrl" type="url" placeholder="https://maps.app.goo.gl/..."/></label><details><summary>Enter coordinates manually</summary><div className="form-row"><label>Latitude<input name="officeLatitude" type="number" step="any" min="-90" max="90"/></label><label>Longitude<input name="officeLongitude" type="number" step="any" min="-180" max="180"/></label></div></details><label>Allowed radius (meters)<input name="officeRadiusMeters" type="number" min="20" max="5000" defaultValue="100" required/></label><button className="button button-primary">Create employee account</button></form>
      <section className="dashboard-panel"><h2>Accounts, PINs, and office locations</h2>{loading ? <p>Loading teamâ€¦</p> : users.map((entry) => <article className="recent-lead" key={entry._id}><span className="mini-avatar">{entry.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><b>{entry.name}</b><small>{entry.employeeId || 'No employee ID'} Â· {entry.email} Â· {entry.active ? 'Active' : 'Deactivated'}</small><form className="pin-reset-form" onSubmit={(event) => onResetPin(event, entry._id)}><label>Reset employee PIN<input name="newPin" type="password" inputMode="numeric" placeholder="New 6-digit PIN" minLength={6} maxLength={6} pattern="[0-9]{6}" required/></label><button className="button button-outline">Reset PIN</button></form><form className="office-location-form" onSubmit={(event) => onSaveLocation(event, entry._id)}><label>Google Maps pin link<input name="officeMapUrl" type="url" placeholder="Paste a pin link to change location"/></label><details><summary>Current coordinates / manual entry</summary><div className="form-row"><label>Latitude<input name="officeLatitude" type="number" step="any" min="-90" max="90" defaultValue={entry.officeLatitude ?? ''}/></label><label>Longitude<input name="officeLongitude" type="number" step="any" min="-180" max="180" defaultValue={entry.officeLongitude ?? ''}/></label></div></details><label>Radius (meters)<input name="officeRadiusMeters" type="number" min="20" max="5000" defaultValue={entry.officeRadiusMeters ?? 100} required/></label><button className="button button-primary">Save location</button></form></span>{entry.role === 'SALESPERSON' && <button className="button button-outline" onClick={() => onToggle(entry._id, !entry.active)}>{entry.active ? 'Deactivate' : 'Activate'}</button>}</article>)}</section>
    </div> : <div className="dashboard-panel"><ShieldAlert/> Only administrators can manage accounts.</div>}
  </section>
}
function JunkLeads({ leads, users, isAdmin, onRestore, onView }: { leads: Lead[]; users: UserOption[]; isAdmin: boolean; onRestore: (id: string, ownerId: string, status: LeadStatus) => void; onView: (id: string) => void }) {
  return <div className="dashboard-panel junk-list">{leads.length ? leads.map((lead) => <article key={lead.id}>
    <div className="junk-lead-info"><div className="junk-lead-title"><b>{lead.name}</b><span className="junk-status">Junk</span></div><small>Phone: {lead.phone}</small><small>Reason: {lead.junkReason || 'Not provided'}</small><small>Added: {fullDate(lead.createdAt)} · Assigned to: {lead.assignedName}</small><div className="junk-lead-flags">{lead.isDuplicate && <span className="duplicate-badge">Duplicate</span>}{lead.doNotContact && <span className="junk-flag">Do not contact</span>}</div></div>
    <button className="button button-outline" onClick={() => onView(lead.id)}>View details</button>
    {isAdmin && <div className="junk-lead-restore"><select aria-label={`Restore status for ${lead.name}`} id={`restore-status-${lead.id}`} defaultValue="NEW">{columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}<option value="NOT_INTERESTED">Not Interested</option></select><select aria-label={`Restore owner for ${lead.name}`} id={`restore-owner-${lead.id}`} defaultValue={users.find((person) => person.active)?._id || ''}>{users.filter((person) => person.active).map((person) => <option value={person._id} key={person._id}>{person.name}</option>)}</select><button className="button button-primary" disabled={!users.some((person) => person.active)} onClick={() => onRestore(lead.id, (document.getElementById(`restore-owner-${lead.id}`) as HTMLSelectElement).value, (document.getElementById(`restore-status-${lead.id}`) as HTMLSelectElement).value as LeadStatus)}>Restore</button></div>}
  </article>) : <p className="empty-copy">No junk leads found.</p>}</div>
}

function LeadModal({ modal, lead, users, onClose, onCreate, onTransfer, onQuote, onJunk, onChooseTransfer, onChooseQuote, onChooseJunk, onNotInterested, onChangeStatus, creating }: { modal: string; lead?: Lead; users: UserOption[]; onClose: () => void; onCreate: (event: FormEvent<HTMLFormElement>) => void; onTransfer: (event: FormEvent<HTMLFormElement>) => void; onQuote: (event: FormEvent<HTMLFormElement>) => void; onJunk: (event: FormEvent<HTMLFormElement>) => void; onChooseTransfer: () => void; onChooseQuote: () => void; onChooseJunk: () => void; onNotInterested: () => void; onChangeStatus: (status: LeadStatus) => void; creating: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose}><X size={19}/></button>
     {modal === 'lead' && <><div className="modal-kicker">LEAD MANAGEMENT</div><h2>Add a new lead</h2><p className="modal-description">Capture a new prospect in your pipeline.</p><form onSubmit={onCreate}><label>Customer name <span className="optional">Optional</span><input name="name" placeholder="e.g. Amit Sharma"/></label><label>Mobile number <span className="required">Required · 10 digits</span><input name="phone" placeholder="9876543210" inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} onChange={(event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10) }} required/></label><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={creating}>Create Lead</button></div></form></>}
    {modal === 'actions' && <><div className="modal-kicker">LEAD ACTIONS</div><h2>{lead?.name}</h2><div className="action-list"><button onClick={onClose}><Eye size={17}/><span><b>View lead</b><small>Open lead details</small></span></button><button onClick={onClose}><MessageSquareText size={17}/><span><b>Add remark</b><small>Write in the details panel</small></span></button><label className="action-status"><SlidersHorizontal size={17}/>Change status<select value={lead?.status || "NEW"} onChange={(event) => onChangeStatus(event.target.value as LeadStatus)}>{columns.map((column) => <option value={column.id} key={column.id}>{column.label}</option>)}<option value="NOT_INTERESTED">Not Interested</option></select></label><button onClick={onChooseQuote}><FileText size={17}/><span><b>Create quotation</b><small>Prepare a customer quotation</small></span></button><button onClick={onChooseTransfer}><ArrowLeftRight size={17}/><span><b>Transfer lead</b><small>Assign to another salesperson</small></span></button><button onClick={onNotInterested}><Ban size={17}/><span><b>Mark Not Interested</b><small>Move this lead directly to the claim pool</small></span></button><button onClick={onChooseJunk}><ShieldAlert size={17}/><span><b>Mark Junk</b><small>Remove from active leads</small></span></button></div></>}
    {modal === 'transfer' && <><div className="modal-kicker">LEAD OWNERSHIP</div><h2>Transfer lead</h2><p className="modal-description">Assign this lead to an active salesperson.</p><form onSubmit={onTransfer}><label>Current owner<input value={lead?.assignedName || ''} readOnly/></label><label>New salesperson<select name="newOwnerId" required>{users.filter((person) => person.active && person.role === 'SALESPERSON' && person._id !== lead?.assignedTo).map((person) => <option value={person._id} key={person._id}>{person.name}</option>)}</select></label><label>Transfer reason <span className="optional">Optional</span><textarea name="reason" placeholder="Add a note for the new owner"/></label><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={creating}>Confirm Transfer</button></div></form></>}
     {modal === 'quote' && <><div className="modal-kicker">QUOTATION</div><h2>Create quotation</h2><p className="modal-description">Required customer information is saved to the lead.</p><form onSubmit={onQuote}><label>Customer / Institute Name<input name="instituteName" defaultValue={lead?.name} required/></label><label>Mobile Number<input name="mobile" defaultValue={lead ? displayPhoneNumber(lead.phone) : undefined} inputMode="numeric" pattern="[0-9]{10}" minLength={10} maxLength={10} onChange={(event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10) }} required/></label><label>Billing Address<input name="billingAddress" required/></label><div className="form-row"><label>City<input name="city" required/></label><label>State<input name="state" required/></label></div><label>PIN Code<input name="pincode" inputMode="numeric" pattern="[0-9]{6}" required/></label><label>Quotation amount<input name="amount" type="number" min="0" required/></label><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={creating}>Save Draft</button></div></form></>}
    {modal === 'junk' && <><div className="modal-kicker">LEAD QUALITY</div><h2>Mark as junk?</h2><p className="modal-description">Junk leads leave the active pipeline and are never claimable.</p><form onSubmit={onJunk}><label>Junk reason<select name="reason"><option>Spam</option><option>Invalid Number</option><option>Duplicate</option><option>Wrong Inquiry</option><option>Other</option></select></label><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Cancel</button><button className="button button-danger" disabled={creating}>Mark as Junk</button></div></form></>}
  </section></div>
}
