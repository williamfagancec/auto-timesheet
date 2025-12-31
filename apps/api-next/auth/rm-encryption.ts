import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Get master encryption key from environment variable
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
 * Get RM-specific encryption key derived from master key
 * Uses HKDF key derivation to create a context-specific key for RM API tokens
 * This ensures RM tokens use a different key than Google OAuth tokens
 */
function getRMEncryptionKey(): Buffer {
  const masterKey = getEncryptionKey();
  // Derive a 32-byte RM-specific key using HKDF with sha256
  return Buffer.from(hkdfSync("sha256", masterKey, "", "rm-api-tokens", 32));
}

/**
 * Encrypt RM API token
 * Returns separate components for database storage
 */
export function encryptRMToken(token: string): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const key = getRMEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt RM API token
 * Accepts separate components from database
 */
export function decryptRMToken(
  encrypted: string,
  iv: string,
  authTag: string
): string {
  const key = getRMEncryptionKey();

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
