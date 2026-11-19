import test from 'node:test'
import assert from 'node:assert/strict'
import { CLAIM_INACTIVITY_MS, getEligibilityDate, isClaimInactivityReached } from '../src/jobs/eligibility-rules.js'

const now = new Date('2026-11-17T10:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000)

test('cold lead becomes eligible after 15 days without qualifying activity', () => {
  const lead = { status: 'COLD', createdAt: daysAgo(20), lastQualifyingActivityAt: daysAgo(15) }
  assert.equal(isClaimInactivityReached(lead, now), true)
  assert.equal(getEligibilityDate(lead)?.getTime(), daysAgo(15).getTime())
})

test('a qualifying interaction resets Cold lead inactivity', () => {
  assert.equal(isClaimInactivityReached({ status: 'COLD', createdAt: daysAgo(30), lastQualifyingActivityAt: daysAgo(14) }, now), false)
})

test('Not Connected lead uses the qualifying activity timestamp', () => {
  assert.equal(isClaimInactivityReached({ status: 'NOT_CONNECTED', createdAt: daysAgo(30), lastQualifyingActivityAt: daysAgo(16) }, now), true)
})

test('Not Interested lead uses the current status timestamp', () => {
  assert.equal(isClaimInactivityReached({ status: 'NOT_INTERESTED', statusChangedAt: daysAgo(15), lastQualifyingActivityAt: daysAgo(50) }, now), true)
  assert.equal(isClaimInactivityReached({ status: 'NOT_INTERESTED', statusChangedAt: daysAgo(14) }, now), false)
})

test('Junk, do-not-contact, and New, Hot, Warm leads never become eligible', () => {
  for (const lead of [
    { status: 'JUNK', createdAt: daysAgo(40) },
    { status: 'COLD', doNotContact: true, createdAt: daysAgo(40) },
    ...['NEW', 'HOT', 'WARM'].map((status) => ({ status, createdAt: daysAgo(40) })),
  ]) assert.equal(isClaimInactivityReached(lead, now), false)
})

test('eligibility begins at the exact 15-day boundary', () => {
  assert.equal(now.getTime() - daysAgo(15).getTime(), CLAIM_INACTIVITY_MS)
  assert.equal(isClaimInactivityReached({ status: 'COLD', lastQualifyingActivityAt: daysAgo(15) }, now), true)
})
