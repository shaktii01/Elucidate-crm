import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/database.js';
const email = process.argv[2]?.trim().toLowerCase();
const password = process.env.CRM_ADMIN_RESET_PASSWORD;
if (!email || !password || password.length < 12 || password.length > 100) {
    throw new Error('Set CRM_ADMIN_RESET_PASSWORD (12–100 characters) and run: npm run admin:reset-password -- admin@example.com');
}
try {
    const admin = await prisma.user.findFirst({ where: { email, role: 'ADMIN' }, select: { id: true } });
    if (!admin)
        throw new Error(`No administrator account found for ${email}`);
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await bcrypt.hash(password, 12) } });
    console.info(`Updated password for administrator ${email}.`);
}
finally {
    await prisma.$disconnect();
}
