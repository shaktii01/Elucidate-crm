import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const envFileCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    fileURLToPath(new URL('../../../../.env', import.meta.url)),
    fileURLToPath(new URL('../../../../../.env', import.meta.url)),
];
const envFile = envFileCandidates.find((candidate) => existsSync(candidate));
if (envFile)
    dotenv.config({ path: envFile });
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32).optional(),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    CLAIM_JOB_CRON: z.string().default('0 * * * *'),
    LOG_LEVEL: z.string().default('info'),
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().url().default('https://localhost'),
});
export const env = envSchema.parse(process.env);
