-- CreateTable
CREATE TABLE `ApiToken` (
  `id` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `name` varchar(191) NOT NULL,
  `tokenHash` char(64) NOT NULL,
  `tokenLast4` varchar(4) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastUsedAt` datetime(3) NULL,
  `revokedAt` datetime(3) NULL,
  UNIQUE INDEX `ApiToken_tokenHash_key`(`tokenHash`),
  INDEX `ApiToken_userId_revokedAt_idx`(`userId`, `revokedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ApiToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProviderCredential` (
  `id` char(36) NOT NULL,
  `userId` char(36) NOT NULL,
  `provider` varchar(64) NOT NULL,
  `label` varchar(191) NOT NULL,
  `encryptedValue` longtext NOT NULL,
  `maskedPreview` varchar(32) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `lastUsedAt` datetime(3) NULL,
  UNIQUE INDEX `ProviderCredential_userId_provider_key`(`userId`, `provider`),
  INDEX `ProviderCredential_userId_idx`(`userId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ProviderCredential_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
