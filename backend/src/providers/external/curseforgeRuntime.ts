// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import type { GameServerRow } from '../../types/gameServer.js';
import { getCurseForgeApiKey, catalogError } from '../../services/curseforge.js';

export function isCurseForgeServer(server: Pick<GameServerRow, 'provider' | 'catalog_id'>): boolean {
    return server.provider === 'external' && /^curseforge:[1-9]\d*$/.test(server.catalog_id ?? '');
}

export async function withCurseForgeCredentials(
    provider: string, catalogId: string | null, image: string, env: string[],
): Promise<string[]> {
    if (provider !== 'external' || !/^curseforge:[1-9]\d*$/.test(catalogId ?? '')) return env;
    // Never attach the panel's key to an arbitrary external image.
    if (!/^itzg\/minecraft-server(?::java(?:8|17|21|25))?(?:@sha256:[a-f0-9]{64})?$/.test(image)) {
        throw catalogError('This modpack server must use the approved Minecraft image');
    }
    const key = await getCurseForgeApiKey();
    // The key exists only in the container runtime, never in the persisted
    // install spec, server configuration API, frontend, or source repository.
    return [...env.filter(value => !/^CF_API_KEY(?:_FILE)?=/.test(value)), 'CF_API_KEY=' + key];
}

export type ModpackStartupStage = 'downloading_server_files' | 'starting_container';
type StartupState = { containerStatus: string; healthStatus: string };

export async function waitForModpackReady(options: {
    inspect: () => Promise<StartupState>;
    logs: () => Promise<string[]>;
    assertExists: () => Promise<void>;
    onStage: (stage: ModpackStartupStage) => Promise<void>;
    pause?: () => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
}): Promise<void> {
    const now = options.now ?? Date.now;
    const deadline = now() + (options.timeoutMs ?? 45 * 60_000);
    const pause = options.pause ?? (() => new Promise(resolve => setTimeout(resolve, 5_000)));
    let stage: ModpackStartupStage = 'downloading_server_files';
    await options.onStage(stage);
    while (now() < deadline) {
        await options.assertExists();
        const runtime = await options.inspect();
        if (runtime.containerStatus === 'running' && runtime.healthStatus === 'healthy') return;
        const logs = (await options.logs()).join('\n');
        if (['exited', 'dead', 'missing', 'restarting'].includes(runtime.containerStatus)) {
            if (/mods need download|manual(?:ly)? download|not allowed.*download|missing.*download/i.test(logs)) {
                throw new Error('Some files require a manual download. Open the server log for links, upload those files into the downloads file root, then start this server to resume.');
            }
            throw new Error('Modpack installation stopped before Minecraft was ready. Open the server log for details. Correct the problem, then start this server to retry.');
        }
        if (stage === 'downloading_server_files' && /starting (?:the )?minecraft|starting net\.minecraft|preparing level/i.test(logs)) {
            stage = 'starting_container';
            await options.onStage(stage);
        }
        await pause();
    }
    throw new Error('The modpack did not become ready within 45 minutes. Check the server log before starting it again.');
}
