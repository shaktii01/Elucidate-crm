import { logger } from './logger.js'
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export async function connectDatabase(): Promise<void> {
  await prisma.$connect()
  await prisma.$queryRaw`SELECT 1`
  logger.info('MySQL connected successfully through Prisma')
}
