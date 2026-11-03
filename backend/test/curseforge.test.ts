// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CurseForgeCatalog, normalizeVersion, recommendedJava, getCurseForgeApiKey } from '../src/services/curseforge.js';
import { resolveCurseForgeInstallSpec } from '../src/providers/external/curseforgeInstall.js';
import { waitForModpackReady, withCurseForgeCredentials } from '../src/providers/external/curseforgeRuntime.js';
import type { ProviderInstallContext } from '../src/providers/installTypes.js';

const apiMod = {
    id: 285109, gameId: 432, classId: 4471, name: 'RLCraft', slug: 'rlcraft', summary: 'A test modpack',
    logo: { thumbnailUrl: 'https://media.forgecdn.net/icon.png' }, authors: [{ name: 'Pack author' }],
    downloadCount: 1234, dateModified: '2026-01-01T00:00:00Z', isAvailable: true, allowModDistribution: true,
};
const apiFile = {
    id: 4612979, modId: 285109, displayName: 'RLCraft 2.9.3', fileName: 'rlcraft.zip',
    fileDate: '2026-01-01T00:00:00Z', releaseType: 1, gameVersions: ['1.12.2', 'Forge'],
    isAvailable: true, isServerPack: false, downloadUrl: 'https://edge.forgecdn.net/files/pack.zip',
};

function catalogFixture(overrides?: { file?: Partial<typeof apiFile>; mod?: Partial<typeof apiMod> }) {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url);
        requests.push({ url: path, init });
        const file = { ...apiFile, ...overrides?.file };
        const mod = { ...apiMod, ...overrides?.mod };
        if (path.includes('/mods/search?')) return Response.json({ data: [mod], pagination: { index: 0, resultCount: 1, totalCount: 1, pageSize: 20 } });
        if (path.includes('/files?')) return Response.json({ data: [{ ...file, id: 999, isServerPack: true }, file], pagination: { index: 0, resultCount: 2, totalCount: 3, pageSize: 20 } });
        return Response.json({ data: path.includes('/files/') ? file : mod });
    }) as typeof fetch;
    return { catalog: new CurseForgeCatalog(async () => 'fixture-key', fetcher), requests };
}

function context(modpack: Record<string, unknown> = {}): ProviderInstallContext {
    return {
        body: { modpack: { platform: 'curseforge', projectId: 285109, fileId: 4612979, acceptEula: true, ...modpack } },
        ports: { tcp: [{ host: 25566, container: 25565, label: 'Minecraft' }], udp: [] },
        resourceLimits: { memoryMb: 6144, cpu: 2 }, healthcheck: null, steamCredentials: null,
    };
}

test('catalog restricts searches to Minecraft modpacks and authenticates only upstream', async () => {
    const { catalog, requests } = catalogFixture();
    const result = await catalog.search({ query: 'RLCraft', sort: 'popular' });
    const url = new URL(requests[0].url);
    assert.equal(url.origin, 'https://api.curseforge.com');
    assert.equal(url.searchParams.get('gameId'), '432');
    assert.equal(url.searchParams.get('classId'), '4471');
    assert.equal(url.searchParams.get('sortField'), '6');
    assert.equal(url.searchParams.get('searchFilter'), 'RLCraft');
    assert.equal(new Headers(requests[0].init?.headers).get('x-api-key'), 'fixture-key');
    assert.equal(requests[0].init?.redirect, 'error');
    assert.equal(result.items[0].name, 'RLCraft');
    assert.equal(JSON.stringify(result).includes('fixture-key'), false);
});

test('simultaneous searches share one request and subsequent searches use a bounded cache', async () => {
    const { catalog, requests } = catalogFixture();
    await Promise.all([catalog.search({}), catalog.search({}), catalog.search({})]);
    await catalog.search({});
    assert.equal(requests.length, 1);
});

test('invalid catalog inputs are rejected without making a network request', async () => {
    const { catalog, requests } = catalogFixture();
    for (const offset of [-1, 10000, '1e3', {}, '2.5']) await assert.rejects(catalog.search({ offset }), /offset/);
    for (const sort of ['__proto__', 'constructor', 'random', {}]) await assert.rejects(catalog.search({ sort }), /sort/);
    await assert.rejects(catalog.search({ query: 'a'.repeat(101) }), /100/);
    await assert.rejects(catalog.versions('../other-project'), /projectId/);
    await assert.rejects(catalog.selection(285109, '1/path'), /fileId/);
    assert.equal(requests.length, 0);
});

test('version pagination counts server archives without offering them as modpack releases', async () => {
    const { catalog } = catalogFixture();
    const result = await catalog.versions(285109);
    assert.equal(result.versions.items.length, 1);
    assert.equal(result.versions.items[0].id, 4612979);
    assert.equal(result.versions.nextOffset, 2);
    assert.equal(result.versions.items[0].recommendedJava, 8);
});

test('missing loader tags do not reject a valid release; the installer reads the manifest', async () => {
    const { catalog } = catalogFixture({ file: { gameVersions: ['1.12.2'] } });
    const result = await catalog.selection(285109, 4612979);
    assert.deepEqual(result.version.loaders, []);
    assert.equal(result.version.installable, true);
});

test('selection revalidates the exact project and release even after browsing', async () => {
    const { catalog, requests } = catalogFixture();
    await catalog.versions(285109);
    await catalog.selection(285109, 4612979);
    await catalog.selection(285109, 4612979);
    assert.equal(requests.filter(request => request.url.endsWith('/mods/285109')).length, 3);
    await assert.rejects(catalogFixture({ file: { modId: 123 } }).catalog.selection(285109, 4612979), /belong/);
    await assert.rejects(catalogFixture({ mod: { classId: 6 } }).catalog.selection(285109, 4612979), /not a Minecraft modpack/);
});

test('restricted, unavailable, and ambiguous releases cannot be installed', async () => {
    const { catalog } = catalogFixture();
    const { pack } = await catalog.selection(285109, 4612979);
    for (const file of [
        { ...apiFile, downloadUrl: null },
        { ...apiFile, isAvailable: false },
        { ...apiFile, isServerPack: true },
        { ...apiFile, gameVersions: ['Forge'] },
        { ...apiFile, gameVersions: ['Forge', '1.12.2', '1.20.1'] },
    ]) assert.equal(normalizeVersion(file, pack).installable, false);
    await assert.rejects(catalogFixture({ mod: { allowModDistribution: false } }).catalog.selection(285109, 4612979), /automatic download/);
});

test('API errors are actionable and do not forward upstream bodies or credentials', async () => {
    for (const [status, expectedStatus] of [[401, 503], [403, 503], [429, 429], [404, 404], [500, 502]]) {
        const catalog = new CurseForgeCatalog(async () => 'fixture-key', (async () => new Response('sensitive upstream detail', { status })) as typeof fetch);
        await assert.rejects(catalog.search({}), (error: Error & { statusCode: number }) => {
            assert.equal(error.statusCode, expectedStatus);
            assert.doesNotMatch(error.message, /sensitive|fixture-key/);
            return true;
        });
    }
});

test('network errors and malformed JSON become recoverable catalog errors', async () => {
    const failed = new CurseForgeCatalog(async () => 'fixture-key', (async () => { throw new Error('network'); }) as typeof fetch);
    await assert.rejects(failed.search({}), /could not be reached/);
    const malformed = new CurseForgeCatalog(async () => 'fixture-key', (async () => new Response('not json')) as typeof fetch);
    await assert.rejects(malformed.search({}), /invalid response/);
});

test('Java recommendations cover legacy and current Minecraft releases', () => {
    for (const [version, java] of [['1.12.2', 8], ['1.16.5', 8], ['1.17.1', 17], ['1.20.4', 17], ['1.20.5', 21], ['1.21.1', 21], ['26.1', 25]] as const) {
        assert.equal(recommendedJava(version), java);
    }
    assert.equal(recommendedJava('snapshot'), null);
});

test('install spec pins the selected release and creates only server-local mounts', async () => {
    const { catalog } = catalogFixture();
    const spec = await resolveCurseForgeInstallSpec(context(), catalog);
    assert.equal(spec.dockerImage, 'itzg/minecraft-server:java8');
    assert.equal(spec.catalogId, 'curseforge:285109');
    assert.ok(spec.env.includes('CF_FILE_ID=4612979'));
    assert.ok(spec.env.includes('MEMORY=4608M'));
    assert.ok(spec.env.includes('VERSION=1.12.2'));
    assert.deepEqual(spec.mounts, [{ key: 'data', containerPath: '/data' }, { key: 'downloads', containerPath: '/downloads' }]);
    assert.equal(JSON.stringify(spec).includes('fixture-key'), false);
    assert.equal(spec.env.some(value => value.startsWith('CF_API_KEY=')), false);
});

test('install validation rejects missing consent and untrusted runtime overrides before upstream requests', async () => {
    const { catalog, requests } = catalogFixture();
    await assert.rejects(resolveCurseForgeInstallSpec(context({ acceptEula: false }), catalog), /EULA/);
    for (const field of ['dockerImage', 'env', 'mounts', 'runtimeIdentity']) {
        const input = context();
        input.body[field] = field === 'dockerImage' ? 'untrusted/image' : {};
        await assert.rejects(resolveCurseForgeInstallSpec(input, catalog), /managed by the panel/);
    }
    const badPort = context();
    badPort.ports.tcp[0].container = 22;
    await assert.rejects(resolveCurseForgeInstallSpec(badPort, catalog), /game port/);
    const badMemory = context();
    badMemory.resourceLimits = { memoryMb: 512 };
    await assert.rejects(resolveCurseForgeInstallSpec(badMemory, catalog), /memory/);
    assert.equal(requests.length, 0);
});

test('installer rejects an obsolete Java override', async () => {
    const { catalog } = catalogFixture({ file: { gameVersions: ['NeoForge', '1.21.1'] } });
    await assert.rejects(resolveCurseForgeInstallSpec(context({ javaVersion: 8 }), catalog), /too old/);
});

test('private key file is read only for approved modpack runtimes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gamepanel-key-test-'));
    const oldKey = process.env.CURSEFORGE_API_KEY;
    const oldFile = process.env.CURSEFORGE_API_KEY_FILE;
    delete process.env.CURSEFORGE_API_KEY;
    process.env.CURSEFORGE_API_KEY_FILE = join(dir, 'key');
    try {
        await assert.rejects(getCurseForgeApiKey(), /not connected/);
        await writeFile(process.env.CURSEFORGE_API_KEY_FILE, 'test-runtime-key\n', { mode: 0o600 });
        const base = ['EULA=TRUE'];
        assert.deepEqual(await withCurseForgeCredentials('external', null, 'custom/image', base), base);
        await assert.rejects(withCurseForgeCredentials('external', 'curseforge:285109', 'custom/image', base), /approved/);
        const env = await withCurseForgeCredentials('external', 'curseforge:285109', 'itzg/minecraft-server:java8', base);
        assert.ok(env.includes('CF_API_KEY=test-runtime-key'));
        assert.deepEqual(base, ['EULA=TRUE']);
        const digest = 'itzg/minecraft-server@sha256:' + 'a'.repeat(64);
        assert.ok((await withCurseForgeCredentials('external', 'curseforge:285109', digest, base)).includes('CF_API_KEY=test-runtime-key'));
    } finally {
        if (oldKey === undefined) delete process.env.CURSEFORGE_API_KEY; else process.env.CURSEFORGE_API_KEY = oldKey;
        if (oldFile === undefined) delete process.env.CURSEFORGE_API_KEY_FILE; else process.env.CURSEFORGE_API_KEY_FILE = oldFile;
        await rm(dir, { recursive: true, force: true });
    }
});

test('install progress waits for game health instead of declaring a running container ready', async () => {
    let tick = 0;
    const stages: string[] = [];
    await waitForModpackReady({
        inspect: async () => ({ containerStatus: 'running', healthStatus: tick >= 2 ? 'healthy' : 'starting' }),
        logs: async () => tick === 1 ? ['Starting the Minecraft server'] : ['Downloading mod files'],
        assertExists: async () => undefined,
        onStage: async stage => { stages.push(stage); },
        pause: async () => { tick++; },
    });
    assert.equal(tick, 2);
    assert.deepEqual(stages, ['downloading_server_files', 'starting_container']);
});

test('restricted download failures explain how to resume the same server', async () => {
    await assert.rejects(waitForModpackReady({
        inspect: async () => ({ containerStatus: 'exited', healthStatus: 'none' }),
        logs: async () => ['Mods Need Download: restricted-mod.jar'],
        assertExists: async () => undefined, onStage: async () => undefined,
    }), /downloads file root.*start this server to resume/);
});

test('missing health checks cannot silently turn into successful installations', async () => {
    let time = 0;
    await assert.rejects(waitForModpackReady({
        inspect: async () => ({ containerStatus: 'running', healthStatus: 'none' }),
        logs: async () => [], assertExists: async () => undefined, onStage: async () => undefined,
        now: () => time, timeoutMs: 3, pause: async () => { time++; },
    }), /did not become ready/);
    assert.equal(time, 3);
});

test('deleting a server cancels monitoring before additional container operations', async () => {
    let inspected = false;
    await assert.rejects(waitForModpackReady({
        inspect: async () => { inspected = true; return { containerStatus: 'running', healthStatus: 'healthy' }; },
        logs: async () => [], assertExists: async () => { throw new Error('Server deleted'); },
        onStage: async () => undefined,
    }), /Server deleted/);
    assert.equal(inspected, false);
});
