// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';

const API_BASE = 'https://api.curseforge.com/v1';
const MINECRAFT_GAME_ID = 432;
const MODPACK_CLASS_ID = 4471;
const PAGE_SIZE = 20;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 100;

export type CurseForgePack = {
    id: number;
    name: string;
    slug: string;
    summary: string;
    iconUrl: string | null;
    websiteUrl: string;
    authors: string[];
    downloads: number;
    updatedAt: string;
    available: boolean;
    distributionAllowed: boolean;
};

export type CurseForgeVersion = {
    id: number;
    projectId: number;
    name: string;
    fileName: string;
    releasedAt: string;
    releaseType: 'release' | 'beta' | 'alpha';
    minecraftVersions: string[];
    loaders: string[];
    recommendedJava: number | null;
    serverPackFileId: number | null;
    installable: boolean;
    unavailableReason: string | null;
};

type ApiMod = {
    id: number; gameId: number; classId: number; name: string; slug: string; summary: string;
    logo?: { thumbnailUrl?: string }; authors?: { name: string }[];
    downloadCount: number; dateModified: string; isAvailable: boolean; allowModDistribution?: boolean | null;
};
type ApiFile = {
    id: number; modId: number; displayName: string; fileName: string; fileDate: string;
    releaseType: number; gameVersions?: string[]; isAvailable: boolean; isServerPack?: boolean;
    serverPackFileId?: number | null; downloadUrl?: string | null;
};
type ApiPage<T> = { data: T[]; pagination: { index: number; pageSize: number; resultCount: number; totalCount: number } };
export type CatalogPage<T> = { items: T[]; offset: number; total: number; nextOffset: number | null };

export function catalogError(message: string, statusCode = 400): Error & { statusCode: number } {
    return Object.assign(new Error(message), { statusCode });
}

export function positiveId(value: unknown, name: string): number {
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^[1-9]\d*$/.test(String(value))) {
        throw catalogError(name + ' must be a positive integer');
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id)) throw catalogError(name + ' is out of range');
    return id;
}

export async function getCurseForgeApiKey(): Promise<string> {
    const direct = process.env.CURSEFORGE_API_KEY?.trim();
    if (direct) return direct;
    try {
        const key = (await readFile(process.env.CURSEFORGE_API_KEY_FILE || '/data/curseforge-api-key', 'utf8')).trim();
        if (key) return key;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw catalogError('The CurseForge API key could not be read. Contact your panel administrator.', 503);
        }
    }
    throw catalogError('CurseForge is not connected. Ask your panel administrator to configure a CurseForge API key.', 503);
}

function safeHttpsUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

export function recommendedJava(version: string): number | null {
    const modern = /^(\d{2})\.\d+(?:\.\d+)?$/.exec(version);
    if (modern && Number(modern[1]) >= 26) return 25;
    const match = /^1\.(\d+)(?:\.(\d+))?$/.exec(version);
    if (!match) return null;
    const minor = Number(match[1]);
    const patch = Number(match[2] ?? 0);
    if (minor <= 16) return 8;
    if (minor < 20 || (minor === 20 && patch < 5)) return 17;
    return 21;
}

function normalizePack(mod: ApiMod): CurseForgePack {
    if (mod.gameId !== MINECRAFT_GAME_ID || mod.classId !== MODPACK_CLASS_ID) {
        throw catalogError('This project is not a Minecraft modpack', 404);
    }
    return {
        id: mod.id, name: mod.name, slug: mod.slug, summary: mod.summary,
        iconUrl: safeHttpsUrl(mod.logo?.thumbnailUrl),
        websiteUrl: 'https://www.curseforge.com/minecraft/modpacks/' + encodeURIComponent(mod.slug),
        authors: (mod.authors ?? []).map(author => author.name),
        downloads: mod.downloadCount, updatedAt: mod.dateModified,
        available: mod.isAvailable === true, distributionAllowed: mod.allowModDistribution !== false,
    };
}

export function normalizeVersion(file: ApiFile, pack: CurseForgePack): CurseForgeVersion {
    const minecraftVersions = (file.gameVersions ?? []).filter(version => recommendedJava(version) !== null);
    const loaders = (file.gameVersions ?? []).filter(version => /^(forge|neoforge|fabric|quilt)$/i.test(version));
    let unavailableReason: string | null = null;
    if (file.modId !== pack.id) throw catalogError('This version does not belong to the selected modpack', 400);
    if (!pack.available || file.isAvailable !== true) unavailableReason = 'This version is no longer available.';
    else if (!pack.distributionAllowed || !safeHttpsUrl(file.downloadUrl)) unavailableReason = 'The author does not provide an automatic download for this version.';
    else if (file.isServerPack) unavailableReason = 'Select a modpack release, rather than its separate server archive.';
    else if (minecraftVersions.length !== 1) unavailableReason = 'This version does not declare one supported Minecraft release.';
    return {
        id: file.id, projectId: file.modId, name: file.displayName, fileName: file.fileName,
        releasedAt: file.fileDate, releaseType: file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release',
        minecraftVersions, loaders, recommendedJava: minecraftVersions.length === 1 ? recommendedJava(minecraftVersions[0]) : null,
        serverPackFileId: file.serverPackFileId || null,
        installable: unavailableReason === null, unavailableReason,
    };
}

function offsetValue(raw: unknown): number {
    if (raw === undefined || raw === '') return 0;
    if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^\d+$/.test(String(raw))) {
        throw catalogError('offset must be a non-negative integer');
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value > 9980) throw catalogError('offset must be between 0 and 9980');
    return value;
}

function page<T, U>(response: ApiPage<T>, items: U[]): CatalogPage<U> {
    const { index, resultCount, totalCount } = response.pagination;
    const next = index + resultCount;
    return { items, offset: index, total: totalCount, nextOffset: resultCount > 0 && next < Math.min(totalCount, 10000) ? next : null };
}

export class CurseForgeCatalog {
    private cache = new Map<string, { expires: number; data: unknown }>();
    private pending = new Map<string, Promise<unknown>>();

    constructor(
        private readonly apiKey: () => Promise<string> = getCurseForgeApiKey,
        private readonly fetcher: typeof fetch = fetch,
    ) {}

    private async request<T>(path: string, cached = true): Promise<T> {
        const key = await this.apiKey();
        const hit = cached ? this.cache.get(path) : undefined;
        if (hit && hit.expires > Date.now()) return hit.data as T;
        const pending = cached ? this.pending.get(path) : undefined;
        if (pending) return pending as Promise<T>;

        const request = (async () => {
            let response: Response;
            try {
                response = await this.fetcher(API_BASE + path, {
                    headers: { Accept: 'application/json', 'x-api-key': key, 'User-Agent': 'GamePanel-CurseForge/1.0 (+https://github.com/SDenny/game-panel)' },
                    signal: AbortSignal.timeout(15_000),
                    redirect: 'error',
                });
            } catch {
                throw catalogError('CurseForge could not be reached. Please try again.', 502);
            }
            if (response.status === 401 || response.status === 403) throw catalogError('CurseForge rejected the configured API key. Contact your panel administrator.', 503);
            if (response.status === 429) throw catalogError('CurseForge is rate limiting requests. Please try again in a minute.', 429);
            if (response.status === 404) throw catalogError('This modpack or version is no longer available on CurseForge.', 404);
            if (!response.ok) throw catalogError('CurseForge is temporarily unavailable. Please try again.', 502);
            let data: T;
            try { data = await response.json() as T; }
            catch { throw catalogError('CurseForge returned an invalid response. Please try again.', 502); }
            if (cached) {
                if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
                this.cache.set(path, { expires: Date.now() + CACHE_TTL_MS, data });
            }
            return data;
        })();
        if (cached) this.pending.set(path, request);
        try { return await request; }
        finally { if (cached) this.pending.delete(path); }
    }

    async search(input: { query?: unknown; sort?: unknown; offset?: unknown }): Promise<CatalogPage<CurseForgePack>> {
        if (input.query !== undefined && typeof input.query !== 'string') throw catalogError('query must be text');
        const query = String(input.query ?? '').trim();
        if (query.length > 100) throw catalogError('Search must be 100 characters or fewer');
        const sort = input.sort ?? (query ? 'relevance' : 'popular');
        const sorts: Record<string, string> = { relevance: '1', popular: '6', updated: '3' };
        if (typeof sort !== 'string' || !Object.prototype.hasOwnProperty.call(sorts, sort)) throw catalogError('Unsupported sort order');
        const params = new URLSearchParams({
            gameId: String(MINECRAFT_GAME_ID), classId: String(MODPACK_CLASS_ID),
            searchFilter: query, sortField: sorts[sort], sortOrder: 'desc',
            index: String(offsetValue(input.offset)), pageSize: String(PAGE_SIZE),
        });
        const result = await this.request<ApiPage<ApiMod>>('/mods/search?' + params);
        return page(result, result.data.filter(mod => mod.gameId === MINECRAFT_GAME_ID && mod.classId === MODPACK_CLASS_ID).map(normalizePack));
    }

    async versions(rawId: unknown, offset?: unknown): Promise<{ pack: CurseForgePack; versions: CatalogPage<CurseForgeVersion> }> {
        const id = positiveId(rawId, 'projectId');
        const params = new URLSearchParams({ index: String(offsetValue(offset)), pageSize: String(PAGE_SIZE) });
        const [mod, files] = await Promise.all([
            this.request<{ data: ApiMod }>('/mods/' + id),
            this.request<ApiPage<ApiFile>>('/mods/' + id + '/files?' + params),
        ]);
        const pack = normalizePack(mod.data);
        return { pack, versions: page(files, files.data.filter(file => !file.isServerPack).map(file => normalizeVersion(file, pack))) };
    }

    async selection(rawProjectId: unknown, rawFileId: unknown): Promise<{ pack: CurseForgePack; version: CurseForgeVersion }> {
        const projectId = positiveId(rawProjectId, 'projectId');
        const fileId = positiveId(rawFileId, 'fileId');
        // Revalidate the exact release at install time; never trust browser metadata.
        const [mod, file] = await Promise.all([
            this.request<{ data: ApiMod }>('/mods/' + projectId, false),
            this.request<{ data: ApiFile }>('/mods/' + projectId + '/files/' + fileId, false),
        ]);
        const pack = normalizePack(mod.data);
        if (pack.id !== projectId || file.data.id !== fileId) throw catalogError('CurseForge returned a different release', 502);
        const version = normalizeVersion(file.data, pack);
        if (!version.installable) throw catalogError(version.unavailableReason || 'This release cannot be installed', 409);
        return { pack, version };
    }
}

export const curseForgeCatalog = new CurseForgeCatalog();
