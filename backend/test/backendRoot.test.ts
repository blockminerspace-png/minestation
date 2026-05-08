import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getBackendRootFromModelsFile, getBackendRootFromSrcAuthFile } from '../lib/backendRoot.js';

describe('backendRoot', () => {
  it('getBackendRootFromModelsFile resolve a partir de models/', () => {
    const fakeUrl = pathToFileURL(path.join(process.cwd(), 'models', 'x.ts')).href;
    const root = getBackendRootFromModelsFile(fakeUrl);
    expect(path.basename(root)).toBe('backend');
  });

  it('getBackendRootFromModelsFile sobe dois níveis a partir de dist/models', () => {
    const fakeUrl = pathToFileURL(path.join(process.cwd(), 'dist', 'models', 'x.js')).href;
    const root = getBackendRootFromModelsFile(fakeUrl);
    expect(path.basename(root)).toBe('backend');
  });

  it('getBackendRootFromSrcAuthFile para src/auth', () => {
    const fakeUrl = pathToFileURL(path.join(process.cwd(), 'src', 'auth', 'x.ts')).href;
    const root = getBackendRootFromSrcAuthFile(fakeUrl);
    expect(path.basename(root)).toBe('backend');
  });

  it('getBackendRootFromSrcAuthFile para dist/src/auth', () => {
    const fakeUrl = pathToFileURL(path.join(process.cwd(), 'dist', 'src', 'auth', 'x.js')).href;
    const root = getBackendRootFromSrcAuthFile(fakeUrl);
    expect(path.basename(root)).toBe('backend');
  });
});
