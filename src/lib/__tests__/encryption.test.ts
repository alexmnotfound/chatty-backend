import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

const { encrypt, decrypt } = await import('../encryption');

describe('encryption', () => {
  it('roundtrip: decrypt(encrypt(x)) === x', () => {
    const plaintext = 'sk-test-api-key-1234567890';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('same plaintext produces different ciphertexts (random IV)', () => {
    const plaintext = 'same-value';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('decrypt throws on tampered ciphertext', () => {
    const enc = encrypt('hello');
    const tampered = enc.slice(0, -4) + 'XXXX';
    expect(() => decrypt(tampered)).toThrow();
  });
});
