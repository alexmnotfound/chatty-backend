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

  it('throws when ENCRYPTION_KEY is missing', () => {
    const savedKey = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
    process.env.ENCRYPTION_KEY = savedKey!;
  });

  it('throws when ENCRYPTION_KEY has non-hex chars', () => {
    const savedKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'g'.repeat(64); // 'g' is not valid hex
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY');
    process.env.ENCRYPTION_KEY = savedKey!;
  });

  it('throws on wrong number of ciphertext segments', () => {
    expect(() => decrypt('onlyone')).toThrow('Invalid ciphertext format');
    expect(() => decrypt('a:b:c:d')).toThrow('Invalid ciphertext format');
  });

  it('handles empty string plaintext', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });
});
