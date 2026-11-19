import cron from 'node-cron'
import { app } from './app.js'
import { connectDatabase } from './config/database.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { evaluateEligibility } from './jobs/lead-eligibility.job.js'
import { sendDueFollowUpReminders } from './jobs/follow-up-reminders.js'

async function startServer(): Promise<void> {
  await connectDatabase()
  try {
    const released = await evaluateEligibility()
    logger.info({ released }, 'Initial claim eligibility check completed')
  } catch (error) {
    logger.error({ err: error }, 'Initial claim eligibility check failed')
  }
  try {
    const sent = await sendDueFollowUpReminders()
    if (sent) logger.info({ sent }, 'Initial follow-up reminders sent')
  } catch (error) {
    logger.error({ err: error }, 'Initial follow-up reminder check failed')
  }
  cron.schedule(env.CLAIM_JOB_CRON, () => {
    void evaluateEligibility().catch((error: unknown) => logger.error({ err: error }, 'Claim eligibility job failed'))
  }, { timezone: 'UTC' })
  cron.schedule('* * * * *', () => {
    void sendDueFollowUpReminders().catch((error: unknown) => logger.error({ err: error }, 'Follow-up reminder job failed'))
  }, { timezone: 'UTC' })
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Elucidate CRM API listening'))
}

void startServer().catch((error: unknown) => {
  logger.error({ err: error }, 'Unable to start API')
  process.exitCode = 1
})
