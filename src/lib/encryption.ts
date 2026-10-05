import crypto from "crypto";
import { getMasterKeyFromKMS, isKMSEnabled } from "./kms";
import { describeCaughtError } from "./log-mask";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for the DEK

// --- Master Key Handling ---

async function getMasterKey(): Promise<Buffer> {
  if (isKMSEnabled()) {
    return getMasterKeyFromKMS();
  }

  const masterKey = process.env.ENCRYPTION_SECRET;
  if (!masterKey) {
    throw new Error("ENCRYPTION_SECRET is not set in environment variables.");
  }
  if (masterKey.length !== 64) {
      console.warn("Warning: ENCRYPTION_SECRET should be a 64-character hex string for a 256-bit key.");
  }
  return Buffer.from(masterKey, "hex");
}

/**
 * Retrieves master key from a hex string (for Zki legacy keys).
 * @param {string} hexKey The 64-character hex string key
 * @returns {Buffer} The master key as a buffer
 */
function getMasterKeyFromHex(hexKey: string): Buffer {
  if (hexKey.length !== 64) {
    console.warn("Warning: Master key should be a 64-character hex string for a 256-bit key.");
  }
  return Buffer.from(hexKey, "hex");
}

// --- Data Encryption Key (DEK) Management ---

/**
 * Generates a new, cryptographically secure Data Encryption Key (DEK).
 * @returns {Buffer} A 32-byte buffer representing the DEK.
 */
export function generateDataKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Encrypts a Data Encryption Key (DEK) using the master key.
 * @param {Buffer} dataKey The DEK to encrypt.
 * @returns {Promise<Buffer>} The encrypted DEK, including IV and auth tag.
 */
export async function encryptDataKey(dataKey: Buffer): Promise<Buffer> {
  const masterKey = await getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const encryptedKey = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encryptedKey]);
}

/**
 * Decrypts an encrypted Data Encryption Key (DEK) using the master key.
 * @param {Buffer} encryptedDataKey The encrypted DEK to decrypt.
 * @returns {Promise<Buffer>} The original plaintext DEK.
 */
export async function decryptDataKey(encryptedDataKey: Buffer): Promise<Buffer> {
  const masterKey = await getMasterKey();
  const iv = encryptedDataKey.slice(0, IV_LENGTH);
  const tag = encryptedDataKey.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encryptedKey = encryptedDataKey.slice(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
}

/**
 * Decrypts an encrypted Data Encryption Key (DEK) using a legacy master key.
 * Used for users who haven't migrated after a key exposure incident.
 * @param {Buffer} encryptedDataKey The encrypted DEK to decrypt.
 * @param {string} legacyMasterKey The legacy master key (hex string) from Zki table.
 * @returns {Buffer} The original plaintext DEK.
 */
export function decryptDataKeyWithLegacy(encryptedDataKey: Buffer, legacyMasterKey: string): Buffer {
  const masterKey = getMasterKeyFromHex(legacyMasterKey);
  const iv = encryptedDataKey.slice(0, IV_LENGTH);
  const tag = encryptedDataKey.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encryptedKey = encryptedDataKey.slice(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
}

// --- Data Encryption/Decryption ---

/**
 * Encrypts plaintext data using a provided Data Encryption Key (DEK).
 * @param {string} text The plaintext string to encrypt.
 * @param {Buffer} key The DEK (must be a 32-byte buffer).
 * @returns {Buffer} The encrypted data, including IV and auth tag.
 */
export function encrypt(text: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypts encrypted data using a provided Data Encryption Key (DEK).
 * @param {Buffer} encryptedData The encrypted data buffer.
 * @param {Buffer} key The DEK (must be a 32-byte buffer).
 * @returns {string} The original decrypted plaintext string.
 */
export function decrypt(encryptedData: Buffer, key: Buffer): string {
  try {
    const iv = encryptedData.slice(0, IV_LENGTH);
    const tag = encryptedData.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = encryptedData.slice(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "Decryption failed";
  }
}

export function encryptBuffer(buf: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBuffer(encryptedData: Buffer, key: Buffer): Buffer {
  if (encryptedData.length < IV_LENGTH + TAG_LENGTH) throw new Error("Decryption failed");
  try {
    const iv = encryptedData.subarray(0, IV_LENGTH);
    const tag = encryptedData.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encryptedData.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new Error("Decryption failed");
  }
}

export function decryptStrict(encryptedData: Buffer, key: Buffer): string {
  return decryptBuffer(encryptedData, key).toString("utf8");
}

// --- Helper Functions ---

/**
 * Masks the API key for display purposes
 * @param {string} key The API key to mask
 * @returns {string} Masked API key
 */
export function maskApiKey(key: string): string {
  if (key.length <= 7) {
    return "sk-****ly8A";
  }
  return `${key.substring(0, 3)}****${key.substring(
    key.length - 3
  )}`;
}

// --- User-specific Data Encryption ---

/**
 * Encrypts data for a user by generating a new DEK and encrypting the data with it.
 * Returns the encrypted DEK and encrypted data as base64 strings.
 * @param {string} text The plaintext data to encrypt
 * @returns {string} Base64 encoded encrypted data (includes encrypted DEK)
 */
export async function encryptData(text: string): Promise<string> {
  try {
    // Generate a new Data Encryption Key for this data
    const dataKey = generateDataKey();
    
    // Encrypt the data with the DEK
    const encryptedData = encrypt(text, dataKey);
    
    // Encrypt the DEK with the master key
    const encryptedDataKey = await encryptDataKey(dataKey);
    
    // Combine encrypted DEK and encrypted data
    const combined = Buffer.concat([
      Buffer.from([encryptedDataKey.length]), // 1 byte for DEK length prefix
      encryptedDataKey,
      encryptedData
    ]);
    
    return combined.toString('base64');
  } catch (error) {
    console.error('Failed to encrypt data:', describeCaughtError(error));
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypts user data by extracting the encrypted DEK and using it to decrypt the data.
 * @param {string} encryptedBase64 Base64 encoded encrypted data
 * @returns {string} The original plaintext data
 */
export async function decryptData(encryptedBase64: string): Promise<string> {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');
    
    // Extract encrypted DEK length
    const dekLength = combined[0];
    
    // Extract encrypted DEK
    const encryptedDataKey = combined.slice(1, 1 + dekLength);
    
    // Extract encrypted data
    const encryptedData = combined.slice(1 + dekLength);
    
    // Decrypt the DEK
    const dataKey = await decryptDataKey(encryptedDataKey);

    // Decrypt the data with the DEK
    const decryptedText = decrypt(encryptedData, dataKey);

    return decryptedText;
  } catch (error) {
    console.error('Failed to decrypt data:', describeCaughtError(error));
    throw new Error('Decryption failed');
  }
}

/**
 * Decrypts user data using a legacy master key (for users with zkiId).
 * @param {string} encryptedBase64 Base64 encoded encrypted data
 * @param {string} legacyMasterKey The legacy master key (hex string) from Zki table
 * @returns {string} The original plaintext data
 */
export async function decryptDataWithLegacy(encryptedBase64: string, legacyMasterKey: string): Promise<string> {
  try {
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract encrypted DEK length
    const dekLength = combined[0];

    // Extract encrypted DEK
    const encryptedDataKey = combined.slice(1, 1 + dekLength);

    // Extract encrypted data
    const encryptedData = combined.slice(1 + dekLength);

    // Decrypt the DEK with legacy key
    const dataKey = decryptDataKeyWithLegacy(encryptedDataKey, legacyMasterKey);

    // Decrypt the data with the DEK
    const decryptedText = decrypt(encryptedData, dataKey);

    return decryptedText;
  } catch (error) {
    console.error('Failed to decrypt data with legacy key:', describeCaughtError(error));
    throw new Error('Decryption failed');
  }
}

// --- Migration Helper Functions ---

/**
 * Re-encrypts a user's DEK from a legacy master key to the current master key.
 * Used during migration after a key exposure incident.
 * @param {Buffer} encryptedDataKey The DEK encrypted with the legacy key
 * @param {string} legacyMasterKey The legacy master key (hex string) from Zki table
 * @returns {Buffer} The DEK re-encrypted with the current master key
 */
export async function migrateDataKey(encryptedDataKey: Buffer, legacyMasterKey: string): Promise<Buffer> {
  // Decrypt with legacy key
  const dataKey = decryptDataKeyWithLegacy(encryptedDataKey, legacyMasterKey);

  // Re-encrypt with current master key
  return await encryptDataKey(dataKey);
}