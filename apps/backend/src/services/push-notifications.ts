import * as webpush from 'web-push'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { prisma } from '../config/database.js'

const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!)

export function getPushPublicKey() { return configured ? env.VAPID_PUBLIC_KEY : null }

export async function sendPushToUser(userId: unknown, payload: { title: string; body: string; url?: string }) {
  if (!configured) return
  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: String(userId) } })
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(subscription as unknown as webpush.PushSubscription, JSON.stringify(payload))
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } })
        else logger.warn({ err: error, userId: String(userId) }, 'Unable to deliver mobile push notification')
      }
    }))
  } catch (error) {
    logger.warn({ err: error, userId: String(userId) }, 'Unable to load mobile push subscriptions')
  }
}
