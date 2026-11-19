import { prisma } from '../config/database.js'
import { logger } from '../config/logger.js'
import { sendPushToUser } from '../services/push-notifications.js'

export async function sendDueFollowUpReminders(now = new Date()): Promise<number> {
  const dueLeads = await prisma.lead.findMany({
    where: { followUpAt: { lte: now }, followUpNotifiedAt: null, assignedToId: { not: null }, doNotContact: false, status: { not: 'JUNK' } },
    select: { id: true, name: true, phone: true, assignedToId: true }, take: 200,
  })
  let sent = 0
  for (const lead of dueLeads) {
    if (!lead.assignedToId) continue
    const claim = await prisma.lead.updateMany({ where: { id: lead.id, followUpAt: { lte: now }, followUpNotifiedAt: null, assignedToId: lead.assignedToId, doNotContact: false, status: { not: 'JUNK' } }, data: { followUpNotifiedAt: now } })
    if (!claim.count) continue
    try {
      const body = `Follow-up due for ${lead.name} (${lead.phone})`
      await prisma.notification.create({ data: { userId: lead.assignedToId, type: 'FOLLOW_UP', leadId: lead.id, message: body } })
      await sendPushToUser(lead.assignedToId, { title: 'CRM follow-up due', body, url: '/' })
      sent += 1
    } catch (error) {
      await prisma.lead.updateMany({ where: { id: lead.id, followUpNotifiedAt: now }, data: { followUpNotifiedAt: null } })
      logger.error({ err: error, leadId: lead.id }, 'Unable to create follow-up reminder')
    }
  }
  return sent
}
