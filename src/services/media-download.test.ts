import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadWhatsAppMedia } from './media-download.js';

describe('downloadWhatsAppMedia', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('fetches the media URL then downloads the binary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://lookaside.fbsbx.com/media/xyz', mime_type: 'image/jpeg' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Response);

    const result = await downloadWhatsAppMedia('media-id-123', 'test-token');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v21.0/media-id-123',
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://lookaside.fbsbx.com/media/xyz',
      { headers: { Authorization: 'Bearer test-token' } },
    );
    expect(result.mimeType).toBe('image/jpeg');
    expect(Buffer.compare(result.buffer, Buffer.from([1, 2, 3]))).toBe(0);
  });

  it('throws if the media lookup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(downloadWhatsAppMedia('bad-id', 'test-token')).rejects.toThrow();
  });
});
