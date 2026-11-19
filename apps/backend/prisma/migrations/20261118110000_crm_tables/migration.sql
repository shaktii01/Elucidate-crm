-- CreateTable
CREATE TABLE `crm_users` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'SALESPERSON') NOT NULL DEFAULT 'SALESPERSON',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `crm_users_employeeId_key`(`employeeId`),
    UNIQUE INDEX `crm_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_leads` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT 'New Client',
    `phone` VARCHAR(191) NOT NULL,
    `normalizedPhone` VARCHAR(191) NOT NULL,
    `isDuplicate` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('NEW', 'HOT', 'WARM', 'COLD', 'NOT_CONNECTED', 'NOT_INTERESTED', 'JUNK') NOT NULL DEFAULT 'NEW',
    `createdById` VARCHAR(191) NOT NULL,
    `assignedToId` VARCHAR(191) NULL,
    `statusChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastQualifyingActivityAt` DATETIME(3) NULL,
    `claimEligibleAt` DATETIME(3) NULL,
    `claimPoolEnteredAt` DATETIME(3) NULL,
    `claimedById` VARCHAR(191) NULL,
    `claimedAt` DATETIME(3) NULL,
    `isClaimable` BOOLEAN NOT NULL DEFAULT false,
    `doNotContact` BOOLEAN NOT NULL DEFAULT false,
    `junkReason` VARCHAR(191) NULL,
    `customerDetails` JSON NULL,
    `followUpAt` DATETIME(3) NULL,
    `followUpNotifiedAt` DATETIME(3) NULL,
    `remarks` JSON NOT NULL,
    `activities` JSON NOT NULL,
    `ownershipHistory` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_leads_normalizedPhone_idx`(`normalizedPhone`),
    INDEX `crm_leads_isDuplicate_idx`(`isDuplicate`),
    INDEX `crm_leads_assignedToId_status_updatedAt_idx`(`assignedToId`, `status`, `updatedAt`),
    INDEX `crm_leads_isClaimable_claimEligibleAt_status_idx`(`isClaimable`, `claimEligibleAt`, `status`),
    INDEX `crm_leads_claimedById_claimedAt_idx`(`claimedById`, `claimedAt`),
    INDEX `crm_leads_followUpAt_followUpNotifiedAt_idx`(`followUpAt`, `followUpNotifiedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_quotations` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `customer` JSON NOT NULL,
    `number` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `amount` DOUBLE NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_quotations_leadId_status_idx`(`leadId`, `status`),
    INDEX `crm_quotations_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_refresh_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `crm_refresh_sessions_tokenHash_key`(`tokenHash`),
    INDEX `crm_refresh_sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NULL,
    `type` VARCHAR(191) NULL,
    `leadId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_notifications_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `crm_notifications_userId_readAt_idx`(`userId`, `readAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_push_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(2048) NOT NULL,
    `expirationTime` DOUBLE NULL,
    `keys` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `crm_push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `crm_push_subscriptions_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `crm_attendance` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE') NOT NULL,
    `checkIn` VARCHAR(191) NOT NULL DEFAULT '',
    `checkOut` VARCHAR(191) NOT NULL DEFAULT '',
    `checkInAt` DATETIME(3) NULL,
    `checkOutAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `markedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `crm_attendance_date_idx`(`date`),
    UNIQUE INDEX `crm_attendance_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `crm_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `crm_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_claimedById_fkey` FOREIGN KEY (`claimedById`) REFERENCES `crm_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `crm_leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `crm_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_refresh_sessions` ADD CONSTRAINT `crm_refresh_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `crm_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_notifications` ADD CONSTRAINT `crm_notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `crm_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_notifications` ADD CONSTRAINT `crm_notifications_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `crm_leads`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_push_subscriptions` ADD CONSTRAINT `crm_push_subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `crm_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_attendance` ADD CONSTRAINT `crm_attendance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `crm_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `crm_attendance` ADD CONSTRAINT `crm_attendance_markedById_fkey` FOREIGN KEY (`markedById`) REFERENCES `crm_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

