// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CatalogPage, CurseForgePack, CurseForgeVersion } from '../types/curseforge';

const api = vi.hoisted(() => ({
  getCurseForgeStatus: vi.fn(),
  searchCurseForgeModpacks: vi.fn(),
  getCurseForgeVersions: vi.fn(),
}));
vi.mock('../utils/api', () => ({ apiClient: api }));

import { CurseForgeModpacks } from '../components/CurseForgeModpacks';

const rlcraft: CurseForgePack = {
  id: 285109, name: 'RLCraft', slug: 'rlcraft', summary: 'Hardcore survival', iconUrl: null,
  websiteUrl: 'https://www.curseforge.com/minecraft/modpacks/rlcraft', authors: ['Shivaxi'],
  downloads: 1_000_000, updatedAt: '2026-01-01T00:00:00Z', available: true, distributionAllowed: true,
};
const restricted: CurseForgePack = { ...rlcraft, id: 2, name: 'Restricted Pack', slug: 'restricted', distributionAllowed: false };

function version(overrides: Partial<CurseForgeVersion>): CurseForgeVersion {
  return {
    id: 4612979, projectId: 285109, name: 'RLCraft 2.9.3', fileName: 'rlcraft.zip',
    releasedAt: '2026-01-01T00:00:00Z', releaseType: 'release', minecraftVersions: ['1.12.2'],
    loaders: ['Forge'], recommendedJava: 8, serverPackFileId: null, installable: true, unavailableReason: null,
    ...overrides,
  };
}

function page<T>(items: T[], nextOffset: number | null = null, total = items.length): CatalogPage<T> {
  return { items, offset: 0, total, nextOffset };
}

function renderPicker(overrides: Partial<Parameters<typeof CurseForgeModpacks>[0]> = {}) {
  const onInstall = vi.fn().mockResolvedValue(undefined);
  const onBack = vi.fn();
  render(<CurseForgeModpacks canInstall onBack={onBack} onInstall={onInstall}
    usedPorts={{ tcp: [25565], udp: [] }} usedServerNames={['RLCraft']} {...overrides} />);
  return { onInstall, onBack, user: userEvent.setup() };
}

beforeEach(() => {
  api.getCurseForgeStatus.mockResolvedValue({ configured: true });
  api.searchCurseForgeModpacks.mockResolvedValue(page([rlcraft, restricted], 20, 40));
  api.getCurseForgeVersions.mockResolvedValue({
    pack: rlcraft,
    versions: page([
      version({ id: 10, name: 'RLCraft 2.9.4 beta', releaseType: 'beta' }),
      version({}),
      version({ id: 11, name: 'RLCraft 2.8', installable: false, unavailableReason: 'restricted' }),
    ]),
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CurseForge modpack catalog', () => {
  it('lists popular packs and blocks packs that cannot be downloaded automatically', async () => {
    renderPicker();
    expect(await screen.findByRole('heading', { name: 'RLCraft' })).toBeTruthy();
    expect(api.searchCurseForgeModpacks).toHaveBeenCalledWith({ query: '', sort: 'popular', offset: 0 }, expect.any(AbortSignal));
    const card = screen.getByRole('heading', { name: 'Restricted Pack' }).closest('article')!;
    expect((within(card).getByRole('button', { name: /select/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByText(/automatic installation is unavailable/i)).toBeTruthy();
  });

  it('searches by relevance and pages through results', async () => {
    const { user } = renderPicker();
    await screen.findByRole('heading', { name: 'RLCraft' });
    await user.type(screen.getByPlaceholderText(/search modpacks/i), '  rlcraft  ');
    await user.click(screen.getByRole('button', { name: /search/i }));
    await waitFor(() => expect(api.searchCurseForgeModpacks).toHaveBeenLastCalledWith(
      { query: 'rlcraft', sort: 'relevance', offset: 0 }, expect.any(AbortSignal)));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.searchCurseForgeModpacks).toHaveBeenLastCalledWith(
      { query: 'rlcraft', sort: 'relevance', offset: 20 }, expect.any(AbortSignal)));
  });

  it('asks for an administrator to connect CurseForge when no API key is configured', async () => {
    api.getCurseForgeStatus.mockResolvedValue({ configured: false });
    renderPicker();
    expect(await screen.findByText(/connect curseforge/i)).toBeTruthy();
    expect(api.searchCurseForgeModpacks).not.toHaveBeenCalled();
  });

  it('shows a retryable error when CurseForge fails', async () => {
    api.searchCurseForgeModpacks.mockRejectedValueOnce({ response: { data: { error: 'CurseForge is rate limiting requests.' } } });
    const { user } = renderPicker();
    expect((await screen.findByRole('alert')).textContent).toMatch(/rate limiting/);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: 'RLCraft' })).toBeTruthy();
  });
});

describe('CurseForge version picker and install', () => {
  async function openRlcraft() {
    const ctx = renderPicker();
    await ctx.user.click(within((await screen.findByRole('heading', { name: 'RLCraft' })).closest('article')!).getByRole('button', { name: /select/i }));
    await screen.findByText(/Minecraft/, { selector: 'p' });
    return ctx;
  }

  it('preselects the newest stable release and shows its Minecraft version, loader, and Java', async () => {
    await openRlcraft();
    const versionSelect = screen.getByRole('combobox', { name: /pack version/i }) as HTMLSelectElement;
    expect(versionSelect.value).toBe('4612979');
    expect(screen.getByText('1.12.2').closest('p')?.textContent).toBe('Minecraft 1.12.2 · Forge');
    expect((screen.getByRole('combobox', { name: /java runtime/i }) as HTMLSelectElement).value).toBe('8');
    expect((screen.getByRole('option', { name: /RLCraft 2.8/ }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('requires EULA consent, then installs the pinned release on a free port with a unique name', async () => {
    const { user, onInstall } = await openRlcraft();
    const install = screen.getByRole('button', { name: /install modpack/i }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    expect(install.disabled).toBe(false);
    await user.click(install);
    expect(onInstall).toHaveBeenCalledWith({
      provider: 'external', name: 'RLCraft (1)',
      ports: { tcp: [{ host: 25566, container: 25565, label: 'Minecraft' }], udp: [] },
      healthcheck: null, resourceLimits: { memoryMb: 6144, cpu: 2 },
      modpack: { platform: 'curseforge', projectId: 285109, fileId: 4612979, javaVersion: 8, acceptEula: true },
    });
  });

  it('rejects ports already used by another server before submitting', async () => {
    const { user, onInstall } = await openRlcraft();
    const port = screen.getByRole('spinbutton', { name: /game port/i });
    await user.clear(port);
    await user.type(port, '25565');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /install modpack/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/available TCP port/);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it('keeps the form open with the backend error when the install request fails', async () => {
    const { user, onInstall } = await openRlcraft();
    onInstall.mockRejectedValueOnce({ response: { data: { error: 'This release cannot be installed' } } });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /install modpack/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot be installed/);
    expect((screen.getByRole('button', { name: /install modpack/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
