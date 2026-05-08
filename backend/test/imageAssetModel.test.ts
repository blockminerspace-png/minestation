import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStoredUploadFilename,
  classifyImageSubfolder,
  organizeLooseFilesInImgRoot,
  parseDataUrlImageStrict,
  resolveLegacyFlatImgFilePath,
  sanitizeOriginalNameBase
} from '../models/imageAssetModel.js';

/** PNG 1×1 válido (mínimo). */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('imageAssetModel', () => {
  it('classifica anúncios e suporte para uploads', () => {
    expect(classifyImageSubfolder('ad-123.png')).toBe('uploads');
    expect(classifyImageSubfolder('support-1-99.png')).toBe('uploads');
    expect(classifyImageSubfolder('support-reply-1-99.png')).toBe('uploads');
  });
  it('classifica carregadores e baterias', () => {
    expect(classifyImageSubfolder('Carregador1bateriapng.png')).toBe('carregadores');
    expect(classifyImageSubfolder('connected_battery_pack_2_16bitpn.png')).toBe('baterias');
    expect(classifyImageSubfolder('1775248013739_pd82x6_15000Whpng.png')).toBe('baterias');
  });
  it('classifica moedas e favicon', () => {
    expect(classifyImageSubfolder('whale.png')).toBe('moedas');
    expect(classifyImageSubfolder('1765327901810_pgwp4v_USDCpng.png')).toBe('moedas');
    expect(classifyImageSubfolder('genesis-miner-logo.png')).toBe('favicon');
  });
  it('classifica restantes como miner', () => {
    expect(classifyImageSubfolder('video_card_var_1_gamingpng.png')).toBe('miner');
    expect(classifyImageSubfolder('rig-61png.png')).toBe('miner');
  });

  it('parseDataUrlImageStrict aceita PNG/JPEG/GIF e rejeita o resto', () => {
    const png = parseDataUrlImageStrict(`data:image/png;base64,${TINY_PNG_B64}`);
    expect(png?.ext).toBe('.png');
    expect(png?.buffer.length).toBeGreaterThan(0);
    expect(parseDataUrlImageStrict('data:image/webp;base64,xx')).toBeNull();
    expect(parseDataUrlImageStrict('not a data url')).toBeNull();
  });

  it('sanitizeOriginalNameBase e buildStoredUploadFilename', () => {
    expect(sanitizeOriginalNameBase('ab@#cd!!')).toBe('abcd');
    expect(sanitizeOriginalNameBase(null)).toBe('image');
    const f = buildStoredUploadFilename('foo', '.png');
    expect(f.endsWith('_foo.png')).toBe(true);
    expect(f).toMatch(/^\d+_[a-z0-9]+_foo\.png$/);
  });

  it('resolveLegacyFlatImgFilePath encontra ficheiro só em miner/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-resolve-'));
    const uploads = path.join(root, 'uploads');
    fs.mkdirSync(path.join(root, 'miner'), { recursive: true });
    fs.mkdirSync(uploads, { recursive: true });
    try {
      fs.writeFileSync(path.join(root, 'miner', 'legacy.png'), Buffer.from(TINY_PNG_B64, 'base64'));
      const abs = resolveLegacyFlatImgFilePath(uploads, root, 'legacy.png');
      expect(abs).toBe(path.resolve(path.join(root, 'miner', 'legacy.png')));
      expect(resolveLegacyFlatImgFilePath(uploads, root, 'miner/legacy.png')).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('organizeLooseFilesInImgRoot move PNG solto para miner/', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minestation-img-'));
    try {
      fs.writeFileSync(path.join(root, 'video_card_test.png'), Buffer.from(TINY_PNG_B64, 'base64'));
      const n = organizeLooseFilesInImgRoot(root);
      expect(n).toBe(1);
      expect(fs.existsSync(path.join(root, 'miner', 'video_card_test.png'))).toBe(true);
      expect(fs.existsSync(path.join(root, 'video_card_test.png'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
