import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { CLAIM_INACTIVITY_DAYS } from '@elucidate-crm/shared';
import { CLAIM_INACTIVITY_MS, getEligibilityDate, isClaimInactivityReached } from './eligibility-rules.js';
export async function evaluateEligibility(now = new Date()) {
    const cutoff = new Date(now.getTime() - CLAIM_INACTIVITY_MS);
    const candidates = await prisma.lead.findMany({
        where: { assignedToId: { not: null }, isClaimable: false, doNotContact: false, status: { in: ['COLD', 'NOT_CONNECTED', 'NOT_INTERESTED'] } },
    });
    let released = 0;
    for (const lead of candidates) {
        const eligibleAt = getEligibilityDate(lead);
        if (!eligibleAt || eligibleAt > cutoff || !isClaimInactivityReached(lead, now) || !lead.assignedToId)
            continue;
        const protectedQuote = await prisma.quotation.findFirst({ where: { leadId: lead.id, status: { in: ['SENT', 'ACCEPTED'] } }, select: { id: true } });
        if (protectedQuote)
            continue;
        const activity = { type: 'CLAIM_POOL', message: `${lead.status} inactivity reached ${CLAIM_INACTIVITY_DAYS} days`, createdAt: now.toISOString() };
        const changed = await prisma.$transaction(async (tx) => {
            const updated = await tx.lead.updateMany({
                where: { id: lead.id, assignedToId: lead.assignedToId, isClaimable: false, doNotContact: false, status: lead.status },
                data: {
                    isClaimable: true, assignedToId: null, claimEligibleAt: eligibleAt, claimPoolEnteredAt: now,
                    activities: [...lead.activities, activity],
                    ownershipHistory: [...lead.ownershipHistory, { from: lead.assignedToId, type: 'CLAIM_POOL', actor: lead.assignedToId, createdAt: now.toISOString() }],
                },
            });
            if (!updated.count)
                return false;
            await tx.notification.create({ data: { userId: lead.assignedToId, type: 'CLAIM_POOL', leadId: lead.id, message: 'Your inactive lead has moved to the shared claim pool' } });
            return true;
        });
        if (changed) {
            released += 1;
            logger.info({ leadId: lead.id }, 'Lead entered claim pool');
        }
    }
    return released;
}
