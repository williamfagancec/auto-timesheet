import { hash, verify } from "@node-rs/argon2";

const hashingOptions = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

/**
 * Hash a password using Argon2
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, hashingOptions);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password, hashingOptions);
  } catch (error) {
    return false;
  }
}
