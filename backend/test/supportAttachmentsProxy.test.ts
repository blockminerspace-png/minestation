import { describe, it, expect } from 'vitest';
import {
  isSafeSupportStoredFilename,
  storedNameFromImgUrl,
  supportStoredFileOwnedByUser,
  rewriteSupportAttachmentsForPlayerDownload
} from '../modules/support/supportAttachmentsProxy.js';
import type { SupportAttachmentItem } from '../models/supportMutationModel.js';

describe('supportAttachmentsProxy', () => {
  it('storedNameFromImgUrl extrai support e support-reply', () => {
    expect(storedNameFromImgUrl('/img/support-12-123-a.png')).toBe('support-12-123-a.png');
    expect(storedNameFromImgUrl('/img/support-reply-3-456-b.webm')).toBe('support-reply-3-456-b.webm');
    expect(storedNameFromImgUrl('/img/evil')).toBeNull();
    expect(storedNameFromImgUrl('https://x/img/support-1-1-a.png')).toBeNull();
  });

  it('isSafeSupportStoredFilename rejeita path traversal', () => {
    expect(isSafeSupportStoredFilename('support-1-1-a.png')).toBe(true);
    expect(isSafeSupportStoredFilename('../support-1-1-a.png')).toBe(false);
    expect(isSafeSupportStoredFilename('support-1-1-a/../x')).toBe(false);
  });

  it('supportStoredFileOwnedByUser só para prefixo support-', () => {
    expect(supportStoredFileOwnedByUser('support-5-1-a.png', 5)).toBe(true);
    expect(supportStoredFileOwnedByUser('support-5-1-a.png', 6)).toBe(false);
    expect(supportStoredFileOwnedByUser('support-reply-1-1-a.png', 1)).toBe(false);
  });

  it('rewrite usa ticket na query para anexos da equipa', () => {
    const tid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const list: SupportAttachmentItem[] = [
      { url: '/img/support-9-99-f.png', originalName: 'f.png', mime: 'image/png' },
      { url: '/img/support-reply-2-88-g.png', originalName: 'g.png', mime: 'image/png' }
    ];
    const out = rewriteSupportAttachmentsForPlayerDownload(9, tid, list);
    expect(out[0].url).toContain('file=');
    expect(out[0].url).toContain(`ticket=${encodeURIComponent(tid)}`);
    expect(out[1].url).toContain('support-reply');
    expect(out[1].url).toContain(`ticket=${encodeURIComponent(tid)}`);
  });
});
