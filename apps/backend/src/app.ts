import crypto from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { z, type ZodType } from 'zod'
import type { Prisma, LeadStatus } from '@prisma/client'
import type { RequestHandler, Response, Request, NextFunction, CookieOptions } from 'express'
import { env } from './config/env.js'
import { prisma } from './config/database.js'
import { logger as log } from './config/logger.js'
import { getPushPublicKey } from './services/push-notifications.js'

const app = express()
const isProduction = env.NODE_ENV === 'production'
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: isProduction, sameSite: 'strict' }

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: env.CLIENT_URL, credentials: true }))
app.use(express.json({ limit: '32kb' }))
app.use(cookieParser())
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })


const phoneSchema = z.string().trim().regex(/^\d{10}$/, 'Enter a 10-digit phone number')
const idSchema = z.string().min(1).max(30)
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
const userIdOf = (user: { _id?: string | { toString(): string }; id?: string }) => String(user._id || user.id)
const issueAccess = (user: { _id?: string; id?: string; role: 'ADMIN' | 'SALESPERSON' }) => jwt.sign({ sub: userIdOf(user), role: user.role }, env.JWT_ACCESS_SECRET, { expiresIn: '15m', issuer: 'elucidate-crm' })
const setRefresh = async (user: { _id?: string | { toString(): string }; id?: string }, res: Response): Promise<void> => {
  const token = crypto.randomBytes(48).toString('base64url')
  await prisma.refreshSession.create({ data: { userId: userIdOf(user), tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 30 * 86400000) } })
  res.cookie('refresh_token', token, { ...COOKIE_OPTIONS, path: '/api/v1/auth', maxAge: 30 * 86400000 })
}
const auth: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies.access_token
    if (!token) return res.status(401).json({ error: 'Authentication required' })
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'elucidate-crm' })
    const user = await prisma.user.findUnique({ where: { id: String(payload.sub) } })
    if (!user?.active) return res.status(401).json({ error: 'Account is inactive' })
    req.user = { _id: user.id, id: user.id, name: user.name, email: user.email, role: user.role, active: user.active }
    next()
  } catch { return res.status(401).json({ error: 'Session expired. Sign in again.' }) }
}
const admin: RequestHandler = (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Admin access required' })
const validate = <T>(schema: ZodType<T>, value: unknown): T => { const result = schema.safeParse(value); if (!result.success) throw Object.assign(new Error(result.error.issues[0]?.message || 'Invalid request'), { status: 400 }); return result.data }
const leadInput = z.object({ name: z.string().trim().max(120).optional(), phone: phoneSchema, status: z.enum(['NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED']).default('NEW'), followUpAt: z.coerce.date().optional(), doNotContact: z.boolean().default(false) })
const canView = (lead: { assignedToId: string | null; isClaimable: boolean }, user: Express.Request['user']) => user.role === 'ADMIN' || lead.assignedToId === user._id || (lead.isClaimable && user.role === 'SALESPERSON')
const canEdit = (lead: { assignedToId: string | null }, user: Express.Request['user']) => user.role === 'ADMIN' || lead.assignedToId === user._id
const jsonArray = (value: Prisma.JsonValue): any[] => Array.isArray(value) ? [...value] : []
const leadPayload = <T extends { id: string; assignedTo?: { id: string; name: string } | null }>(lead: T) => ({ ...lead, _id: lead.id, assignedTo: lead.assignedTo ? { ...lead.assignedTo, _id: lead.assignedTo.id } : null })
const refreshDuplicateFlags = async (normalizedPhone: string): Promise<boolean> => {
  const isDuplicate = await prisma.lead.count({ where: { normalizedPhone } }) > 1
  await prisma.lead.updateMany({ where: { normalizedPhone }, data: { isDuplicate } })
  return isDuplicate
}

app.get('/api/v1/health', async (_req, res) => { try { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true, database: 'connected' }) } catch { res.status(503).json({ ok: false, database: 'disconnected' }) } })
app.post('/api/v1/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res, next) => {
  try {
    const { identifier, password } = validate(z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(200) }), req.body)
    const normalizedIdentifier = identifier.toLowerCase()
    const user = await prisma.user.findFirst({ where: { OR: [{ email: normalizedIdentifier }, { employeeId: identifier.toUpperCase() }] } })
    if (!user?.active || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect' })
    res.cookie('access_token', issueAccess(user), { ...COOKIE_OPTIONS, path: '/api/v1', maxAge: 15 * 60 * 1000 })
    await setRefresh(user, res)
    res.json({ data: { id: user.id, name: user.name, email: user.email, role: user.role } })
  } catch (error) { next(error) }
})
const employeePinSchema = z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits')
app.post('/api/v1/auth/change-pin', auth, rateLimit({ windowMs: 15 * 60 * 1000, limit: 5 }), async (req, res, next) => {
  try {
    const body = validate(z.object({ currentPin: z.string().min(1).max(200), newPin: employeePinSchema }), req.body)
    const user = await prisma.user.findUnique({ where: { id: req.user._id }, select: { id: true, passwordHash: true } })
    if (!user || !await bcrypt.compare(body.currentPin, user.passwordHash)) return res.status(401).json({ error: 'Current password or PIN is incorrect.' })
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.newPin, 12) } })
    const currentRefreshToken = req.cookies.refresh_token
    await prisma.refreshSession.deleteMany({ where: { userId: user.id, ...(currentRefreshToken ? { tokenHash: { not: tokenHash(currentRefreshToken) } } : {}) } })
    res.json({ message: 'Your PIN has been changed.' })
  } catch (error) { next(error) }
})
app.post('/api/v1/auth/refresh', async (req, res, next) => {
  try {
    const oldToken = req.cookies.refresh_token
    if (!oldToken) return res.status(401).json({ error: 'Refresh session required' })
    const session = await prisma.refreshSession.findFirst({ where: { tokenHash: tokenHash(oldToken), expiresAt: { gt: new Date() } } })
    if (!session) return res.status(401).json({ error: 'Refresh session expired' })
    await prisma.refreshSession.delete({ where: { id: session.id } })
    const user = await prisma.user.findUnique({ where: { id: session.userId } })
    if (!user?.active) return res.status(401).json({ error: 'Account is inactive' })
    res.cookie('access_token', issueAccess(user), { ...COOKIE_OPTIONS, path: '/api/v1', maxAge: 15 * 60 * 1000 }); await setRefresh(user, res)
    res.json({ data: { id: user.id, name: user.name, email: user.email, role: user.role } })
  } catch (error) { next(error) }
})
app.post('/api/v1/auth/logout', async (req, res) => { if (req.cookies.refresh_token) await prisma.refreshSession.deleteMany({ where: { tokenHash: tokenHash(req.cookies.refresh_token) } }); res.clearCookie('access_token', { ...COOKIE_OPTIONS, path: '/api/v1' }); res.clearCookie('refresh_token', { ...COOKIE_OPTIONS, path: '/api/v1/auth' }); res.status(204).end() })
app.get('/api/v1/auth/me', auth, (req, res) => res.json({ data: req.user }))

app.get('/api/v1/users', auth, async (req, res) => { const users = await prisma.user.findMany({ where: req.user.role === 'ADMIN' ? {} : { active: true }, select: { id: true, name: true, employeeId: true, email: true, role: true, active: true, officeLatitude: true, officeLongitude: true, officeRadiusMeters: true }, orderBy: { name: 'asc' } }); res.json({ data: users.map((user) => ({ ...user, _id: user.id })) }) })
const extractMapCoordinates = (value: string) => {
  const patterns = [/@(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) { const latitude = Number(match[1]); const longitude = Number(match[2]); if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude } }
  }
  try {
    const url = new URL(value)
    for (const key of ['q', 'query', 'll', 'center', 'destination']) {
      const coordinate = url.searchParams.get(key)?.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/)
      if (coordinate) { const latitude = Number(coordinate[1]); const longitude = Number(coordinate[2]); if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude } }
    }
  } catch { /* The caller validates the URL. */ }
  return null
}
const isGoogleMapsHost = (hostname: string) => hostname === 'maps.app.goo.gl' || hostname === 'goo.gl' || hostname === 'google.com' || hostname.endsWith('.google.com')
app.post('/api/v1/office-location/resolve', auth, admin, async (req, res, next) => {
  try {
    const { url: rawUrl } = validate(z.object({ url: z.string().url().max(2048) }), req.body)
    let current = new URL(rawUrl)
    if (current.protocol !== 'https:' || !isGoogleMapsHost(current.hostname)) return res.status(400).json({ error: 'Paste a valid Google Maps pin link.' })
    let resolved = extractMapCoordinates(current.href)
    for (let redirects = 0; !resolved && redirects < 6; redirects++) {
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ElucidateCRM/1.0 office-location-link-resolver' } })
      const nextUrl = response.headers.get('location')
      if (!nextUrl) break
      current = new URL(nextUrl, current)
      if (current.protocol !== 'https:' || !isGoogleMapsHost(current.hostname)) return res.status(400).json({ error: 'This link does not redirect to a Google Maps location.' })
      resolved = extractMapCoordinates(current.href)
    }
    if (!resolved) return res.status(422).json({ error: 'Could not read coordinates from this Maps link. Copy the full Google Maps location link and try again.' })
    res.json({ data: resolved })
  } catch (error) { next(error) }
})
app.post('/api/v1/users', auth, admin, async (req, res, next) => { try { const body = validate(z.object({ name: z.string().trim().min(1).max(100), employeeId: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()), email: z.union([z.string().email(), z.literal('')]).optional(), password: employeePinSchema, role: z.enum(['ADMIN', 'SALESPERSON']).default('SALESPERSON'), officeLatitude: z.number().min(-90).max(90), officeLongitude: z.number().min(-180).max(180), officeRadiusMeters: z.number().int().min(20).max(5000).default(100) }), req.body); const { password, ...profile } = body; const email = (profile.email || `${profile.employeeId.toLowerCase()}@employees.elucidate.local`).toLowerCase(); const user = await prisma.user.create({ data: { ...profile, email, passwordHash: await bcrypt.hash(password, 12) } }); res.status(201).json({ data: { id: user.id, _id: user.id, name: user.name, employeeId: user.employeeId, email: user.email, role: user.role, active: user.active } }) } catch (error) { next(error) } })
app.post('/api/v1/users/:id/reset-pin', auth, async (req, res, next) => {
  try {
    const id = validate(idSchema, req.params.id)
    const body = validate(z.object({ newPin: employeePinSchema, currentPin: z.string().min(1).max(200).optional() }), req.body)
    const isSelf = id === req.user._id
    if (!isSelf && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required to reset another account PIN.' })
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, passwordHash: true } })
    if (!target) return res.status(404).json({ error: 'User not found.' })
    if (isSelf && (!body.currentPin || !await bcrypt.compare(body.currentPin, target.passwordHash))) return res.status(401).json({ error: 'Current password or PIN is incorrect.' })
    await prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(body.newPin, 12) } })
    if (isSelf) {
      const currentRefreshToken = req.cookies.refresh_token
      await prisma.refreshSession.deleteMany({ where: { userId: id, ...(currentRefreshToken ? { tokenHash: { not: tokenHash(currentRefreshToken) } } : {}) } })
    } else await prisma.refreshSession.deleteMany({ where: { userId: id } })
    res.json({ message: isSelf ? 'Your PIN has been changed.' : 'Employee PIN has been reset.' })
  } catch (error) { next(error) }
})
app.patch('/api/v1/users/:id', auth, admin, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const body = validate(z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional(), officeLatitude: z.number().min(-90).max(90).nullable().optional(), officeLongitude: z.number().min(-180).max(180).nullable().optional(), officeRadiusMeters: z.number().int().min(20).max(5000).optional() }), req.body); const user = await prisma.user.update({ where: { id }, data: body, select: { id: true, name: true, email: true, role: true, active: true, officeLatitude: true, officeLongitude: true, officeRadiusMeters: true } }).catch((error: unknown) => { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') return null; throw error }); if (!user) return res.status(404).json({ error: 'User not found' }); res.json({ data: { ...user, _id: user.id } }) } catch (error) { next(error) } })

const attendanceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format').refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value }, 'Choose a valid date')
const currentAttendanceDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const punchLocationSchema = z.object({ date: attendanceDateSchema, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1000, 'Device location accuracy is too low. Enable precise location and retry.') })
const validatePunchLocation = async (userId: string, location: { latitude: number; longitude: number; accuracy: number }, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { officeLatitude: true, officeLongitude: true, officeRadiusMeters: true } })
  if (user?.officeLatitude == null || user.officeLongitude == null) { res.status(403).json({ error: 'Your office location has not been assigned. Contact your administrator.' }); return false }
  if (location.accuracy > 500) { res.status(400).json({ error: `Your device location is too imprecise (about ±${Math.round(location.accuracy)} m). Turn on precise location and try again.` }); return false }
  const radians = (degrees: number) => degrees * Math.PI / 180
  const dLat = radians(location.latitude - user.officeLatitude)
  const dLon = radians(location.longitude - user.officeLongitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(user.officeLatitude)) * Math.cos(radians(location.latitude)) * Math.sin(dLon / 2) ** 2
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const gpsTolerance = Math.min(location.accuracy, 100)
  if (distance > user.officeRadiusMeters + gpsTolerance) { res.status(403).json({ error: `Your reported location is ${Math.round(distance)} m from the assigned office (radius ${user.officeRadiusMeters} m). Enable precise location and try again.` }); return false }
  return true
}
app.get('/api/v1/attendance', auth, admin, async (req, res, next) => {
  try {
    const dateString = validate(attendanceDateSchema, String(req.query.date || new Date().toISOString().slice(0, 10)))
    const date = new Date(`${dateString}T00:00:00.000Z`)
    const employees = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, employeeId: true, email: true, role: true, active: true }, orderBy: { name: 'asc' } })
    const rows = await prisma.attendance.findMany({ where: { date, userId: { in: employees.map((employee) => employee.id) } } })
    const byUser = new Map(rows.map((row) => [row.userId, row]))
    res.json({ data: employees.map((employee) => ({ ...employee, _id: employee.id, attendance: byUser.has(employee.id) ? { ...byUser.get(employee.id), _id: byUser.get(employee.id)!.id } : null })) })
  } catch (error) { next(error) }
})
app.get('/api/v1/attendance/mine', auth, async (req, res, next) => {
  try {
    const dateString = validate(attendanceDateSchema, String(req.query.date || new Date().toISOString().slice(0, 10)))
    const record = await prisma.attendance.findUnique({ where: { userId_date: { userId: req.user._id, date: new Date(`${dateString}T00:00:00.000Z`) } } })
    res.json({ data: record ? { ...record, _id: record.id } : null })
  } catch (error) { next(error) }
})
app.post('/api/v1/attendance/punch-in', auth, async (req, res, next) => {
  try {
    const body = validate(punchLocationSchema, req.body)
    if (body.date !== currentAttendanceDate()) return res.status(400).json({ error: 'Punch actions are only available for today' })
    if (!await validatePunchLocation(req.user._id, body, res)) return
    const date = new Date(`${body.date}T00:00:00.000Z`)
    const now = new Date()
    const key = { userId_date: { userId: req.user._id, date } }
    const existing = await prisma.attendance.findUnique({ where: key })
    if (existing?.checkInAt || existing?.checkIn) return res.status(409).json({ error: 'You have already punched in today' })
    let record
    if (existing) {
      const updated = await prisma.attendance.updateMany({ where: { id: existing.id, checkInAt: null, checkIn: '' }, data: { status: 'PRESENT', checkInAt: now, markedById: req.user._id } })
      if (!updated.count) return res.status(409).json({ error: 'You have already punched in today' })
      record = await prisma.attendance.findUniqueOrThrow({ where: key })
    } else {
      try { record = await prisma.attendance.create({ data: { userId: req.user._id, date, status: 'PRESENT', checkInAt: now, markedById: req.user._id } }) }
      catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') return res.status(409).json({ error: 'You have already punched in today' }); throw error }
    }
    res.status(201).json({ data: { ...record, _id: record.id } })
  } catch (error) { next(error) }
})
app.post('/api/v1/attendance/punch-out', auth, async (req, res, next) => {
  try {
    const body = validate(punchLocationSchema, req.body)
    if (body.date !== currentAttendanceDate()) return res.status(400).json({ error: 'Punch actions are only available for today' })
    if (!await validatePunchLocation(req.user._id, body, res)) return
    const date = new Date(`${body.date}T00:00:00.000Z`)
    const key = { userId_date: { userId: req.user._id, date } }
    const current = await prisma.attendance.findUnique({ where: key })
    if (!current || (!current.checkInAt && !current.checkIn)) return res.status(409).json({ error: 'Punch in before punching out' })
    if (current.checkOutAt || current.checkOut) return res.status(409).json({ error: 'You have already punched out today' })
    const now = new Date()
    const updated = await prisma.attendance.updateMany({ where: { userId: req.user._id, date, checkOutAt: null, checkOut: '' }, data: { checkOutAt: now, markedById: req.user._id } })
    if (!updated.count) return res.status(409).json({ error: 'Punch out has already been recorded' })
    const record = await prisma.attendance.findUniqueOrThrow({ where: key })
    res.json({ data: { ...record, _id: record.id } })
  } catch (error) { next(error) }
})
app.put('/api/v1/attendance/:userId', auth, admin, async (req, res, next) => {
  try {
    const userId = validate(idSchema, req.params.userId)
    const body = validate(z.object({ date: attendanceDateSchema, status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']), checkIn: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).optional(), checkOut: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).optional(), note: z.string().trim().max(500).optional() }), req.body)
    const employee = await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true } })
    if (!employee) return res.status(404).json({ error: 'Active employee not found' })
    const date = new Date(`${body.date}T00:00:00.000Z`)
    const record = await prisma.attendance.upsert({ where: { userId_date: { userId, date } }, create: { userId, date, status: body.status, checkIn: body.checkIn ?? '', checkOut: body.checkOut ?? '', note: body.note ?? '', markedById: req.user._id }, update: { status: body.status, ...(body.checkIn !== undefined ? { checkIn: body.checkIn } : {}), ...(body.checkOut !== undefined ? { checkOut: body.checkOut } : {}), ...(body.note !== undefined ? { note: body.note } : {}), markedById: req.user._id } })
    res.json({ data: { ...record, _id: record.id } })
  } catch (error) { next(error) }
})

app.get('/api/v1/leads', auth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    const query: Prisma.LeadWhereInput = req.query.claimedOnly === 'true'
      ? { claimedById: req.user._id, assignedToId: req.user._id, status: { not: 'JUNK' } }
      : req.user.role === 'ADMIN' ? { status: { not: 'JUNK' } } : { assignedToId: req.user._id, status: { not: 'JUNK' } }
    if (req.query.status) query.status = validate(z.enum(['NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED', 'JUNK']), String(req.query.status)) as LeadStatus
    if (req.query.search) query.OR = [{ name: { contains: String(req.query.search).slice(0, 80) } }, { phone: { contains: String(req.query.search).slice(0, 30) } }]
    const [data, total] = await Promise.all([
      prisma.lead.findMany({ where: query, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { assignedTo: { select: { id: true, name: true } }, quotations: { orderBy: { createdAt: 'desc' }, take: 1, select: { amount: true } } } }),
      prisma.lead.count({ where: query }),
    ])
    res.json({ data: data.map((lead) => ({ ...lead, _id: lead.id, assignedTo: lead.assignedTo ? { ...lead.assignedTo, _id: lead.assignedTo.id } : null, quotationAmount: lead.quotations[0]?.amount ?? null })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (error) { next(error) }
})
app.post('/api/v1/leads', auth, async (req, res, next) => { try { const body = validate(leadInput, req.body); const normalizedPhone = body.phone.replace(/\D/g, ''); const now = new Date(); const lead = await prisma.lead.create({ data: { name: body.name || 'New Client', phone: body.phone, normalizedPhone, status: body.status, createdById: req.user._id, assignedToId: req.user._id, statusChangedAt: now, followUpAt: body.followUpAt, doNotContact: body.doNotContact, activities: [{ type: 'CREATED', actor: req.user._id, message: 'Lead created', createdAt: now.toISOString() }], ownershipHistory: [{ to: req.user._id, type: 'CREATED', actor: req.user._id, createdAt: now.toISOString() }] } }); const isDuplicate = await refreshDuplicateFlags(normalizedPhone); res.status(201).json({ data: { ...lead, _id: lead.id, isDuplicate } }) } catch (error) { next(error) } })
app.get('/api/v1/leads/:id', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const lead = await prisma.lead.findUnique({ where: { id }, include: { assignedTo: { select: { id: true, name: true } } } }); if (!lead || !canView(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); res.json({ data: leadPayload(lead) }) } catch (error) { next(error) } })
app.patch('/api/v1/leads/:id', auth, async (req, res, next) => {
  try {
    const id = validate(idSchema, req.params.id)
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' })
    const body = validate(z.object({ name: z.string().trim().min(1).max(120).optional(), phone: phoneSchema.optional(), doNotContact: z.boolean().optional(), followUpAt: z.coerce.date().nullable().optional(), customerDetails: z.record(z.string(), z.unknown()).optional() }).strict(), req.body)
    if (body.followUpAt instanceof Date && body.followUpAt <= new Date()) return res.status(400).json({ error: 'Choose a future follow-up time' })
    const oldNormalizedPhone = lead.normalizedPhone
    const normalizedPhone = body.phone ? body.phone.replace(/\D/g, '') : oldNormalizedPhone
    const activities = jsonArray(lead.activities)
    if (body.followUpAt !== undefined) activities.push({ type: body.followUpAt ? 'FOLLOW_UP_SCHEDULED' : 'FOLLOW_UP_CLEARED', actor: req.user._id, message: body.followUpAt ? `Follow-up scheduled for ${body.followUpAt.toLocaleString()}` : 'Follow-up reminder cleared', createdAt: new Date().toISOString() })
    const { customerDetails, ...leadFields } = body
    const updated = await prisma.lead.update({ where: { id }, data: { ...leadFields, normalizedPhone, ...(body.phone ? { phone: body.phone } : {}), ...(body.followUpAt !== undefined ? { followUpNotifiedAt: null, activities } : {}), ...(customerDetails !== undefined ? { customerDetails: customerDetails as Prisma.InputJsonValue } : {}) }, include: { assignedTo: { select: { id: true, name: true } } } })
    if (normalizedPhone !== oldNormalizedPhone) { await refreshDuplicateFlags(oldNormalizedPhone); updated.isDuplicate = await refreshDuplicateFlags(normalizedPhone) }
    res.json({ data: leadPayload(updated) })
  } catch (error) { next(error) }
})
app.patch('/api/v1/leads/:id/status', auth, async (req, res, next) => {
  try {
    const body = validate(z.object({ status: z.enum(['NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED']), reason: z.string().max(500).optional() }), req.body)
    const id = validate(idSchema, req.params.id)
    const lead = await prisma.lead.findUnique({ where: { id } })
    if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' })

    const enteringClaimPool = body.status === 'NOT_INTERESTED'
    if (enteringClaimPool && await prisma.quotation.findFirst({ where: { leadId: lead.id, status: { in: ['SENT', 'ACCEPTED'] } }, select: { id: true } })) {
      return res.status(409).json({ error: 'This lead has a sent or accepted quotation and cannot be moved to the claim pool' })
    }

    const previousStatus = lead.status
    const previousOwner = lead.assignedToId
    const now = new Date()
    const activities = jsonArray(lead.activities)
    activities.push({ type: 'STATUS_CHANGED', actor: req.user._id, fromStatus: previousStatus, toStatus: body.status, message: body.reason ?? null, createdAt: now.toISOString() })
    const ownershipHistory = jsonArray(lead.ownershipHistory)
    if (enteringClaimPool) {
      activities.push({ type: 'CLAIM_POOL', actor: req.user._id, message: 'Moved to the claim pool immediately after being marked Not Interested', createdAt: now.toISOString() })
      ownershipHistory.push({ from: previousOwner, type: 'CLAIM_POOL', actor: req.user._id, createdAt: now.toISOString() })
    }
    const updatedLead = await prisma.lead.update({ where: { id }, data: { status: body.status, statusChangedAt: now, activities, ...(enteringClaimPool ? { isClaimable: true, assignedToId: null, claimEligibleAt: now, claimPoolEnteredAt: now } : { isClaimable: false, claimEligibleAt: null }), ownershipHistory } })
    if (enteringClaimPool && previousOwner) {
      await prisma.notification.create({ data: { userId: previousOwner, type: 'CLAIM_POOL', leadId: lead.id, message: 'Your lead was marked Not Interested and moved to the shared claim pool' } })
    }
    res.json({ data: { ...updatedLead, _id: updatedLead.id } })
  } catch (error) { next(error) }
})
app.post('/api/v1/leads/:id/remarks', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const { message } = validate(z.object({ message: z.string().trim().min(1).max(2000) }), req.body); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); const createdAt = new Date().toISOString(); const remarks = jsonArray(lead.remarks); remarks.push({ userId: req.user._id, message, createdAt }); const activities = jsonArray(lead.activities); activities.push({ type: 'REMARK', actor: req.user._id, message, createdAt }); await prisma.lead.update({ where: { id }, data: { remarks, activities } }); res.status(201).json({ data: { _id: `${id}-remark-${Date.now()}`, userId: req.user._id, message, createdAt } }) } catch (error) { next(error) } })
app.post('/api/v1/leads/:id/activities', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const body = validate(z.object({ type: z.literal('QUALIFYING_INTERACTION'), message: z.string().trim().min(3).max(500) }), req.body); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); const now = new Date(); const activities = jsonArray(lead.activities); activities.push({ type: body.type, actor: req.user._id, message: body.message, createdAt: now.toISOString() }); const updated = await prisma.lead.update({ where: { id }, data: { lastQualifyingActivityAt: now, activities } }); res.status(201).json({ data: { ...updated, _id: updated.id } }) } catch (error) { next(error) } })
app.get('/api/v1/leads/:id/activities', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || !canView(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); const before = req.query.before ? new Date(String(req.query.before)) : null; const remarks = jsonArray(lead.remarks).map((remark) => ({ ...(remark as Record<string, Prisma.JsonValue>), type: 'REMARK' })); const activities = [...jsonArray(lead.activities), ...remarks].filter((activity) => !before || new Date(String(activity.createdAt)) < before).sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime()).slice(0, 50); res.json({ data: activities, nextCursor: activities.length === 50 ? activities.at(-1)?.createdAt : null }) } catch (error) { next(error) } })

app.get('/api/v1/lead-claims', auth, async (_req, res) => { const data = await prisma.lead.findMany({ where: { isClaimable: true, assignedToId: null, doNotContact: false, status: { not: 'JUNK' } }, include: { createdBy: { select: { id: true, name: true } } }, orderBy: { claimPoolEnteredAt: 'asc' }, take: 100 }); res.json({ data: data.map((lead) => ({ ...leadPayload(lead), createdBy: { ...lead.createdBy, _id: lead.createdBy.id } })) }) })
app.get('/api/v1/lead-claims/mine', auth, async (req, res) => { const data = await prisma.lead.findMany({ where: { claimedById: req.user._id }, orderBy: { claimedAt: 'desc' }, take: 100 }); res.json({ data: data.map((lead) => ({ ...lead, _id: lead.id })) }) })
app.post('/api/v1/lead-claims/:leadId/claim', auth, async (req, res, next) => {
  try {
    const leadId = validate(idSchema, req.params.leadId)
    const claimed = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId } })
      if (!lead || !lead.isClaimable || lead.assignedToId || lead.doNotContact || lead.status === 'JUNK') throw Object.assign(new Error('This lead has already been claimed or is no longer available'), { status: 409 })
      const protectedQuote = await tx.quotation.findFirst({ where: { leadId, status: { in: ['SENT', 'ACCEPTED'] } } })
      if (protectedQuote) throw Object.assign(new Error('This lead has an active quotation and cannot be claimed'), { status: 409 })
      const now = new Date()
      const result = await tx.lead.updateMany({ where: { id: leadId, isClaimable: true, assignedToId: null, doNotContact: false, status: { not: 'JUNK' } }, data: { assignedToId: req.user._id, isClaimable: false, claimedById: req.user._id, claimedAt: now, ownershipHistory: [...jsonArray(lead.ownershipHistory), { to: req.user._id, type: 'CLAIMED', actor: req.user._id, createdAt: now.toISOString() }], activities: [...jsonArray(lead.activities), { type: 'CLAIMED', actor: req.user._id, message: 'Lead claimed', createdAt: now.toISOString() }] } })
      if (!result.count) throw Object.assign(new Error('This lead has already been claimed or is no longer available'), { status: 409 })
      await tx.notification.create({ data: { userId: req.user._id, type: 'CLAIMED', leadId, message: 'You successfully claimed a lead' } })
      return tx.lead.findUnique({ where: { id: leadId }, include: { assignedTo: { select: { id: true, name: true } } } })
    })
    res.json({ data: claimed ? leadPayload(claimed) : null })
  } catch (error) { next(error) }
})

app.post('/api/v1/leads/:id/transfer', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const { newOwnerId, reason } = validate(z.object({ newOwnerId: idSchema, reason: z.string().max(500).optional() }), req.body); if (newOwnerId === req.user._id) return res.status(400).json({ error: 'Lead is already assigned to you' }); const receiver = await prisma.user.findFirst({ where: { id: newOwnerId, active: true, role: 'SALESPERSON' } }); if (!receiver) return res.status(400).json({ error: 'Select an active salesperson' }); const result = await prisma.$transaction(async (tx) => { const lead = await tx.lead.findUnique({ where: { id } }); if (!lead || lead.assignedToId !== req.user._id || lead.status === 'JUNK' || lead.isClaimable || lead.doNotContact) return null; const now = new Date(); const updated = await tx.lead.updateMany({ where: { id, assignedToId: req.user._id, status: { not: 'JUNK' }, isClaimable: false, doNotContact: false }, data: { assignedToId: newOwnerId, ownershipHistory: [...jsonArray(lead.ownershipHistory), { from: req.user._id, to: newOwnerId, type: 'TRANSFERRED', reason: reason ?? null, actor: req.user._id, createdAt: now.toISOString() }], activities: [...jsonArray(lead.activities), { type: 'TRANSFERRED', actor: req.user._id, message: reason || 'Lead transferred', createdAt: now.toISOString() }] } }); if (!updated.count) return null; await tx.notification.create({ data: { userId: receiver.id, type: 'TRANSFER', leadId: id, message: `Lead transferred to you by ${req.user.name}${reason ? `: ${reason}` : ''}` } }); return tx.lead.findUnique({ where: { id }, include: { assignedTo: { select: { id: true, name: true } } } }) }); if (!result) return res.status(409).json({ error: 'Lead cannot be transferred in its current state' }); res.json({ data: leadPayload(result) }) } catch (error) { next(error) } })
app.get('/api/v1/leads/:id/ownership-history', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || !canView(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); res.json({ data: lead.ownershipHistory }) } catch (error) { next(error) } })

app.post('/api/v1/leads/:id/junk', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const { reason } = validate(z.object({ reason: z.enum(['Spam', 'Invalid Number', 'Duplicate', 'Wrong Inquiry', 'Other']) }), req.body); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); const now = new Date(); const updated = await prisma.lead.update({ where: { id }, data: { status: 'JUNK', junkReason: reason, isClaimable: false, assignedToId: req.user._id, statusChangedAt: now, activities: [...jsonArray(lead.activities), { type: 'MARKED_JUNK', actor: req.user._id, fromStatus: lead.status, toStatus: 'JUNK', message: reason, createdAt: now.toISOString() }] } }); res.json({ data: { ...updated, _id: updated.id } }) } catch (error) { next(error) } })
app.post('/api/v1/leads/:id/restore', auth, admin, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const { status, ownerId } = validate(z.object({ status: z.enum(['NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED']), ownerId: idSchema }), req.body); const owner = await prisma.user.findFirst({ where: { id: ownerId, active: true } }); if (!owner) return res.status(400).json({ error: 'Select an active owner' }); const lead = await prisma.lead.findUnique({ where: { id } }); if (!lead || lead.status !== 'JUNK') return res.status(404).json({ error: 'Junk lead not found' }); const now = new Date(); const updated = await prisma.lead.update({ where: { id }, data: { status, assignedToId: ownerId, statusChangedAt: now, isClaimable: false, junkReason: null, activities: [...jsonArray(lead.activities), { type: 'RESTORED', actor: req.user._id, fromStatus: 'JUNK', toStatus: status, message: 'Lead restored by admin', createdAt: now.toISOString() }] } }); res.json({ data: { ...updated, _id: updated.id } }) } catch (error) { next(error) } })

app.get('/api/v1/quotations', auth, async (req, res) => { const leadFilter = req.user.role === 'ADMIN' ? undefined : (await prisma.lead.findMany({ where: { assignedToId: req.user._id }, select: { id: true } })).map((lead) => lead.id); const data = await prisma.quotation.findMany({ where: leadFilter ? { leadId: { in: leadFilter } } : {}, orderBy: { createdAt: 'desc' }, take: 100 }); res.json({ data: data.map((quote) => ({ ...quote, _id: quote.id })) }) })
app.post('/api/v1/quotations', auth, async (req, res, next) => { try { const body = validate(z.object({ leadId: idSchema, customer: z.object({ instituteName: z.string().trim().min(1), mobile: phoneSchema, billingAddress: z.string().trim().min(1), city: z.string().trim().min(1), state: z.string().trim().min(1), pincode: z.string().regex(/^\d{6}$/), alternateMobile: phoneSchema.optional(), email: z.string().email().optional(), contactPerson: z.string().optional(), gstin: z.string().optional() }), amount: z.number().nonnegative(), status: z.enum(['DRAFT', 'SENT']).default('DRAFT') }), req.body); const lead = await prisma.lead.findUnique({ where: { id: body.leadId } }); if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Lead not found' }); const number = `Q-${Date.now()}`; const created = await prisma.$transaction(async (tx) => { const quote = await tx.quotation.create({ data: { leadId: body.leadId, customer: body.customer as Prisma.InputJsonValue, amount: body.amount, status: body.status, createdById: req.user._id, number } }); await tx.lead.update({ where: { id: lead.id }, data: { customerDetails: body.customer as Prisma.InputJsonValue, activities: [...jsonArray(lead.activities), { type: 'QUOTATION_CREATED', actor: req.user._id, message: `Quotation ${number} created`, createdAt: new Date().toISOString() }] } }); return quote }); res.status(201).json({ data: { ...created, _id: created.id } }) } catch (error) { next(error) } })
app.patch('/api/v1/quotations/:id/status', auth, async (req, res, next) => { try { const id = validate(idSchema, req.params.id); const { status } = validate(z.object({ status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED']) }), req.body); const quote = await prisma.quotation.findUnique({ where: { id } }); if (!quote) return res.status(404).json({ error: 'Quotation not found' }); const lead = await prisma.lead.findUnique({ where: { id: quote.leadId } }); if (!lead || !canEdit(lead, req.user)) return res.status(404).json({ error: 'Quotation not found' }); const updated = await prisma.$transaction(async (tx) => { const result = await tx.quotation.update({ where: { id }, data: { status } }); await tx.lead.update({ where: { id: lead.id }, data: { activities: [...jsonArray(lead.activities), { type: 'QUOTATION_STATUS', actor: req.user._id, message: `Quotation ${quote.number} is ${status}`, createdAt: new Date().toISOString() }] } }); return result }); res.json({ data: { ...updated, _id: updated.id } }) } catch (error) { next(error) } })
app.get('/api/v1/quotations/:id', auth, async (req, res) => { const id = validate(idSchema, req.params.id); const quote = await prisma.quotation.findUnique({ where: { id } }); const lead = quote && await prisma.lead.findUnique({ where: { id: quote.leadId } }); if (!quote || !lead || !canView(lead, req.user)) return res.status(404).json({ error: 'Quotation not found' }); res.json({ data: { ...quote, _id: quote.id } }) })

app.get('/api/v1/dashboard/leads', auth, admin, async (req, res, next) => { try { const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20)); const search = String(req.query.search || '').trim().slice(0, 80); const where: Prisma.LeadWhereInput = search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }] } : {}; const [data, total] = await Promise.all([prisma.lead.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { assignedTo: { select: { id: true, name: true, employeeId: true } } } }), prisma.lead.count({ where })]); res.json({ data: data.map((lead) => ({ ...lead, _id: lead.id, assignedTo: lead.assignedTo ? { ...lead.assignedTo, _id: lead.assignedTo.id } : null })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } }) } catch (error) { next(error) } })
app.get('/api/v1/dashboard/summary', auth, async (req, res, next) => { try { const scope: Prisma.LeadWhereInput = req.user.role === 'ADMIN' ? {} : { assignedToId: req.user._id }; const [counts, available, claimed, due] = await Promise.all([prisma.lead.groupBy({ by: ['status'], where: scope, _count: { _all: true } }), prisma.lead.count({ where: { isClaimable: true } }), prisma.lead.count({ where: { claimedById: req.user._id } }), prisma.lead.count({ where: { ...scope, followUpAt: { lte: new Date() }, status: { not: 'JUNK' } } })]); const result: Record<string, number> = Object.fromEntries(counts.map((item) => [item.status, item._count._all])); res.json({ data: { total: Object.values(result).reduce<number>((a, b) => a + b, 0), statuses: result, availableToClaim: available, myClaimed: claimed, followUpsDue: due } }) } catch (error) { next(error) } })
app.get('/api/v1/notifications', auth, async (req, res) => { const [items, unread] = await Promise.all([prisma.notification.findMany({ where: { userId: req.user._id }, orderBy: { createdAt: 'desc' }, take: 50 }), prisma.notification.count({ where: { userId: req.user._id, readAt: null } })]); res.json({ data: items.map((item) => ({ ...item, _id: item.id })), unread }) })
app.get('/api/v1/push/public-key', auth, (_req, res) => { const publicKey = getPushPublicKey(); if (!publicKey) return res.status(503).json({ error: 'Mobile push notifications are not configured on this server' }); res.json({ publicKey }) })
app.post('/api/v1/push/subscribe', auth, async (req, res, next) => { try { const body = validate(z.object({ endpoint: z.string().url(), expirationTime: z.number().nullable().optional(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) }), req.body); await prisma.pushSubscription.upsert({ where: { endpoint: body.endpoint }, create: { endpoint: body.endpoint, userId: req.user._id, expirationTime: body.expirationTime, keys: body.keys as Prisma.InputJsonValue }, update: { userId: req.user._id, expirationTime: body.expirationTime, keys: body.keys as Prisma.InputJsonValue } }); res.status(201).json({ success: true }) } catch (error) { next(error) } })
app.delete('/api/v1/push/subscribe', auth, async (req, res) => { const endpoint = String(req.body?.endpoint || ''); if (endpoint) await prisma.pushSubscription.deleteMany({ where: { userId: req.user._id, endpoint } }); res.json({ success: true }) })
app.get('/api/v1/transfer-requests', auth, async (req, res) => { const data = await prisma.notification.findMany({ where: { userId: req.user._id, type: 'TRANSFER' }, orderBy: { createdAt: 'desc' }, take: 100 }); res.json({ data: data.map((item) => ({ ...item, _id: item.id })) }) })
app.patch('/api/v1/notifications/:id/read', auth, async (req, res) => { const id = validate(idSchema, req.params.id); const result = await prisma.notification.updateMany({ where: { id, userId: req.user._id }, data: { readAt: new Date() } }); if (!result.count) return res.status(404).json({ error: 'Notification not found' }); const item = await prisma.notification.findUnique({ where: { id } }); res.json({ data: item ? { ...item, _id: item.id } : null }) })


app.use((error: unknown, req: Request, res: Response, next: NextFunction) => { void req; void next; const errorRecord = typeof error === 'object' && error !== null ? error as { status?: number; code?: number | string; message?: string; keyPattern?: Record<string, unknown>; meta?: { target?: string[] | string } } : {}; const prismaConflict = errorRecord.code === 'P2002'; const status = errorRecord.status || (errorRecord.code === 11000 || prismaConflict ? 409 : 500); if (status === 500) log.error({ err: error }, 'Request failed'); const conflictMessage = errorRecord.code === 11000 ? (errorRecord.keyPattern?.normalizedPhone ? 'A lead with this phone number already exists.' : errorRecord.keyPattern?.employeeId ? 'That employee ID is already in use.' : 'This record already exists.') : prismaConflict ? (String(errorRecord.meta?.target).includes('employeeId') ? 'That employee ID is already in use.' : 'This record already exists.') : null; res.status(status).json({ error: status === 500 ? 'Internal server error' : conflictMessage || errorRecord.message || 'Request failed' }) })
export { app }

