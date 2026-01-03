/**
 * RM Connection Service
 * Handles RM API connection management and credential storage
 */

import { prisma } from "database";
import { encryptRMToken, decryptRMToken } from "../auth/rm-encryption";
import { rmApi, RMAuthError, type RMUser } from "./rm-api";

/**
 * Create RM connection for a user
 * Validates token with RM API and stores encrypted credentials
 */
export async function createConnection(
  userId: string,
  apiToken: string
): Promise<{
  id: string;
  userId: string;
  rmUserId: number;
  rmUserEmail: string;
  rmUserName: string | null;
  createdAt: Date;
}> {
  // Validate token with RM API and get user info
  let rmUser: RMUser;
  try {
    rmUser = await rmApi.validateToken(apiToken);
  } catch (error) {
    if (error instanceof RMAuthError) {
      throw new Error("Invalid RM API token - please check your token and try again");
    }
    throw new Error(
      `Failed to connect to RM API: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Encrypt the API token
  const { encrypted, iv, authTag } = encryptRMToken(apiToken);

  // Check if connection already exists
  const existingConnection = await prisma.rMConnection.findUnique({
    where: { userId },
  });

  if (existingConnection) {
    // Update existing connection
    const connection = await prisma.rMConnection.update({
      where: { userId },
      data: {
        encryptedToken: encrypted,
        tokenIv: iv,
        tokenAuthTag: authTag,
        rmUserId: rmUser.id,
        rmUserEmail: rmUser.email,
        rmUserName: rmUser.name ||
        (rmUser.first_name && rmUser.last_name
          ? `${rmUser.first_name} ${rmUser.last_name}`.trim()
          : null),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        userId: true,
        rmUserId: true,
        rmUserEmail: true,
        rmUserName: true,
        createdAt: true,
      },
    });

    return connection;
  }

  // Create new connection
  const connection = await prisma.rMConnection.create({
    data: {
      userId,
      encryptedToken: encrypted,
      tokenIv: iv,
      tokenAuthTag: authTag,
      rmUserId: rmUser.id,
      rmUserEmail: rmUser.email,
      rmUserName: rmUser.name ||
        (rmUser.first_name && rmUser.last_name
          ? `${rmUser.first_name} ${rmUser.last_name}`.trim()
          : null),
      autoSyncEnabled: false,
    },
    select: {
      id: true,
      userId: true,
      rmUserId: true,
      rmUserEmail: true,
      rmUserName: true,
      createdAt: true,
    },
  });

  return connection;
}

/**
 * Get RM connection for a user
 * Returns null if no connection exists
 */
export async function getConnection(userId: string): Promise<{
  id: string;
  userId: string;
  rmUserId: number;
  rmUserEmail: string;
  rmUserName: string | null;
  autoSyncEnabled: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
    select: {
      id: true,
      userId: true,
      rmUserId: true,
      rmUserEmail: true,
      rmUserName: true,
      autoSyncEnabled: true,
      lastSyncAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return connection;
}

/**
 * Validate that a connection is still active
 * Returns true if token is valid, false otherwise
 */
export async function validateConnection(userId: string): Promise<boolean> {
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return false;
  }

  try {
    // Decrypt token
    const token = decryptRMToken(
      connection.encryptedToken,
      connection.tokenIv,
      connection.tokenAuthTag
    );

    // Validate with RM API
    await rmApi.validateToken(token);
    return true;
  } catch (error) {
    // Token is invalid
    return false;
  }
}

/**
 * Delete RM connection and all related data
 * Cascade deletes project mappings, synced entries, and sync logs
 *
 * Idempotent: safe to call even if no connection exists
 */
export async function deleteConnection(userId: string): Promise<void> {
  await prisma.rMConnection.deleteMany({
    where: { userId },
  });
}

/**
 * Get decrypted RM API token for a user
 * Throws error if no connection exists
 */
export async function getDecryptedToken(userId: string): Promise<string> {
  const connection = await prisma.rMConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    throw new Error("RM connection not found - please connect your RM account first");
  }

  return decryptRMToken(
    connection.encryptedToken,
    connection.tokenIv,
    connection.tokenAuthTag
  );
}

/**
 * Update last sync timestamp
 */
export async function updateLastSyncAt(userId: string): Promise<void> {
  await prisma.rMConnection.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });
}

/**
 * Update auto-sync setting
 */
export async function updateAutoSyncEnabled(
  userId: string,
  enabled: boolean
): Promise<void> {
  await prisma.rMConnection.update({
    where: { userId },
    data: { autoSyncEnabled: enabled },
  });
}
