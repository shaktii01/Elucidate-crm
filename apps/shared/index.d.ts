export declare const CLAIM_INACTIVITY_DAYS: 15

export interface LeadRecord {
  _id: string
  name: string
  phone: string
  status: 'NEW' | 'HOT' | 'WARM' | 'COLD' | 'NOT_CONNECTED' | 'NOT_INTERESTED' | 'JUNK'
  assignedTo?: string | { _id: string; name: string; employeeId?: string } | null
  createdAt: string
  updatedAt: string
  followUpAt?: string | null
  quotationAmount?: number | null
  junkReason?: string
  isClaimable: boolean
  doNotContact: boolean
  isDuplicate: boolean
  activities?: Array<{ message?: string; type: string; createdAt: string; fromStatus?: string; toStatus?: string }>
  remarks?: Array<{ message: string; createdAt: string }>
}
