ALTER TABLE `crm_users`
  ADD COLUMN `officeLatitude` DOUBLE NULL,
  ADD COLUMN `officeLongitude` DOUBLE NULL,
  ADD COLUMN `officeRadiusMeters` INTEGER NOT NULL DEFAULT 100;