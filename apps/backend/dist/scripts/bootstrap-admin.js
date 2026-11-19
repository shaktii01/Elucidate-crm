import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/database.js';
const [name, email, passwordArg] = process.argv.slice(2);
const password = passwordArg || process.env.CRM_ADMIN_BOOTSTRAP_PASSWORD;
if (!name || !email || !password || password.length < 12) {
    throw new Error('Set CRM_ADMIN_BOOTSTRAP_PASSWORD (12+ characters), then run: npm run bootstrap:admin -- "Admin Name" admin@example.com');
}
try {
    if (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) {
        throw new Error('An admin account already exists. The bootstrap command only creates the initial administrator.');
    }
    const user = await prisma.user.create({ data: {
            name: name.trim(), email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN',
        } });
    if (!user)
        throw new Error('Administrator account was not created');
    console.info(`Created initial admin account ${user.email} (${user.id}).`);
}
finally {
    await prisma.$disconnect();
}
