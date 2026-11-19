import { CLAIM_INACTIVITY_DAYS } from '@elucidate-crm/shared';
export const CLAIM_INACTIVITY_MS = CLAIM_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;
export function getEligibilityDate(lead) {
    if (lead.doNotContact || lead.status === 'JUNK')
        return null;
    if (lead.status === 'NOT_INTERESTED')
        return lead.statusChangedAt ? new Date(lead.statusChangedAt) : null;
    if (lead.status === 'COLD' || lead.status === 'NOT_CONNECTED') {
        const timestamp = lead.lastQualifyingActivityAt || lead.createdAt;
        return timestamp ? new Date(timestamp) : null;
    }
    return null;
}
export function isClaimInactivityReached(lead, now = new Date()) {
    const eligibleFrom = getEligibilityDate(lead);
    return Boolean(eligibleFrom && now.getTime() - eligibleFrom.getTime() >= CLAIM_INACTIVITY_MS);
}
