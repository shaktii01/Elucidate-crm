import { CLAIM_INACTIVITY_DAYS } from '@elucidate-crm/shared'

export const CLAIM_INACTIVITY_MS = CLAIM_INACTIVITY_DAYS * 24 * 60 * 60 * 1000

export interface EligibilityLead {
  status: string
  doNotContact?: boolean
  createdAt?: Date | string
  statusChangedAt?: Date | string
  lastQualifyingActivityAt?: Date | string | null
}

export function getEligibilityDate(lead: EligibilityLead): Date | null {
  if (lead.doNotContact || lead.status === 'JUNK') return null
  if (lead.status === 'NOT_INTERESTED') return lead.statusChangedAt ? new Date(lead.statusChangedAt) : null
  if (lead.status === 'COLD' || lead.status === 'NOT_CONNECTED') {
    const timestamp = lead.lastQualifyingActivityAt || lead.createdAt
    return timestamp ? new Date(timestamp) : null
  }
  return null
}

export function isClaimInactivityReached(lead: EligibilityLead, now = new Date()): boolean {
  const eligibleFrom = getEligibilityDate(lead)
  return Boolean(eligibleFrom && now.getTime() - eligibleFrom.getTime() >= CLAIM_INACTIVITY_MS)
}
