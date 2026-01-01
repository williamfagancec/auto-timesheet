import { PrismaClient } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

declare global {
  var prisma: PrismaClient | undefined
}

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === 'production';

// Encryption utilities for OAuth tokens
// Uses the same ENCRYPTION_KEY as other token encryption in the app
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  if (key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(key, "hex");
}

function encryptToken(text: string | null | undefined): string | null {
  if (!text) return null;
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  const result = Buffer.concat([iv, tag, encrypted]);
  return result.toString('base64');
}

function decryptToken(encryptedData: string | null | undefined): string | null {
  if (!encryptedData) return null;
  const key = getEncryptionKey();
  const buffer = Buffer.from(encryptedData, 'base64');
  
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = buffer.subarray(ENCRYPTED_POSITION);
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [
        { level: 'query', emit: 'event' },
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' }
      ]
    : ['error'],

    ...(databaseUrl && isProduction ? {
    datasources: {
      db: {
        url: databaseUrl + (databaseUrl.includes('?') ? '&' : '?') + 'pgbouncer=true',
      },
    },
  } : {}),
})

// Prisma middleware to encrypt/decrypt OAuth tokens transparently
prisma.$use(async (params, next) => {
  // Encrypt tokens before writing to database
  if (params.model === 'Account') {
    if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
      if (params.args.data) {
        // Handle create/update
        const data = params.args.data;
        if (data.accessToken !== undefined) {
          data.accessToken = encryptToken(data.accessToken);
        }
        if (data.refreshToken !== undefined) {
          data.refreshToken = encryptToken(data.refreshToken);
        }
        // Handle upsert create/update
        if (params.action === 'upsert' && params.args.create) {
          if (params.args.create.accessToken !== undefined) {
            params.args.create.accessToken = encryptToken(params.args.create.accessToken);
          }
          if (params.args.create.refreshToken !== undefined) {
            params.args.create.refreshToken = encryptToken(params.args.create.refreshToken);
          }
        }
        if (params.action === 'upsert' && params.args.update) {
          if (params.args.update.accessToken !== undefined) {
            params.args.update.accessToken = encryptToken(params.args.update.accessToken);
          }
          if (params.args.update.refreshToken !== undefined) {
            params.args.update.refreshToken = encryptToken(params.args.update.refreshToken);
          }
        }
      }
    }
  }

  const result = await next(params);

  // Decrypt tokens after reading from database
  if (params.model === 'Account') {
    // Handle all read operations that return Account records
    if (params.action === 'findUnique' || params.action === 'findFirst' || params.action === 'findMany' || params.action === 'updateMany') {
      if (result) {
        if (Array.isArray(result)) {
          result.forEach((account: any) => {
            if (account && account.accessToken) account.accessToken = decryptToken(account.accessToken);
            if (account && account.refreshToken) account.refreshToken = decryptToken(account.refreshToken);
          });
        } else if (result && typeof result === 'object') {
          if (result.accessToken) result.accessToken = decryptToken(result.accessToken);
          if (result.refreshToken) result.refreshToken = decryptToken(result.refreshToken);
        }
      }
    }
  }

  return result;
});

// Log slow queries in development (>100ms)
if (process.env.NODE_ENV === 'development') {
  // @ts-expect-error - query event not in default types
  prisma.$on('query', (e: { duration: number; query: string }) => {
    if (e.duration > 100) {
      console.log(`[Slow Query] ${e.duration}ms: ${e.query.substring(0, 100)}...`)
    }
  })
}

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

export * from '@prisma/client'
