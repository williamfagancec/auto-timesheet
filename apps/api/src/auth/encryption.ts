import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

/**
 * Get encryption key from environment variable
 * The key must be 32 bytes (64 hex characters)
 */
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

/**
 * Encrypt a string (e.g., OAuth token)
 * Returns a base64-encoded string containing: salt + iv + tag + encrypted data
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Combine iv + tag + encrypted data
  const result = Buffer.concat([iv, tag, encrypted]);
  return result.toString("base64");
}

/**
 * Decrypt an encrypted string
 * Expects base64-encoded string containing: salt + iv + tag + encrypted data
 */
export function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const buffer = Buffer.from(encryptedData, "base64");

  // Extract components
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = buffer.subarray(ENCRYPTED_POSITION);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Generate a random encryption key (for initial setup)
 * Returns a 32-byte key as a 64-character hex string
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}
