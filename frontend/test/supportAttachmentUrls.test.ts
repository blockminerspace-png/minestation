import { describe, it, expect } from 'vitest';
import { safeSupportAttachmentHref } from '../utils/supportAttachmentUrls';

describe('safeSupportAttachmentHref', () => {
  it('aceita caminhos /img/ e download API seguro', () => {
    expect(safeSupportAttachmentHref('/img/uploads/x.png')).toBe('/img/uploads/x.png');
    const tid = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const dl = `/api/support/attachments/download?file=${encodeURIComponent('support-1-2-a.png')}&ticket=${encodeURIComponent(tid)}`;
    expect(safeSupportAttachmentHref(dl)).toBe(dl);
  });

  it('rejeita URLs absolutas e esquemas', () => {
    expect(safeSupportAttachmentHref('https://evil.com/img/x')).toBeUndefined();
    expect(safeSupportAttachmentHref('javascript:alert(1)')).toBeUndefined();
    expect(safeSupportAttachmentHref('data:text/html,x')).toBeUndefined();
    expect(safeSupportAttachmentHref('//evil.com/img')).toBeUndefined();
  });

  it('trim permite espaços à volta de /img/…', () => {
    expect(safeSupportAttachmentHref(' /img/x ')).toBe('/img/x');
  });

  it('rejeita espaços no meio do caminho e não-string', () => {
    expect(safeSupportAttachmentHref('/img/ x')).toBeUndefined();
    expect(safeSupportAttachmentHref(null)).toBeUndefined();
  });
});
