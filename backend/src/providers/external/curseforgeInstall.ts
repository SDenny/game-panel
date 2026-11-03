// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto';
import { catalogError, curseForgeCatalog, type CurseForgeCatalog } from '../../services/curseforge.js';
import type { ProviderInstallContext, ResolvedInstallSpec } from '../installTypes.js';
import { runtimeConfigForIdentity } from '../runtimeIdentity.js';

export async function resolveCurseForgeInstallSpec(
    ctx: ProviderInstallContext,
    catalog: Pick<CurseForgeCatalog, 'selection'> = curseForgeCatalog,
): Promise<ResolvedInstallSpec> {
    const raw = ctx.body.modpack;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw catalogError('modpack must be an object');
    const input = raw as Record<string, unknown>;
    if (input.platform !== 'curseforge') throw catalogError('Unsupported modpack platform');
    if (input.acceptEula !== true) throw catalogError('You must accept the Minecraft EULA before installing');
    if (ctx.ports.tcp.length !== 1 || ctx.ports.tcp[0].container !== 25565 || ctx.ports.udp.length !== 0) {
        throw catalogError('Modpacks require one TCP game port mapped to container port 25565');
    }
    const memoryMb = ctx.resourceLimits?.memoryMb;
    if (!memoryMb || memoryMb < 2048 || memoryMb > 262144) throw catalogError('Choose between 2048 and 262144 MB of server memory');
    if (ctx.body.dockerImage || ctx.body.env || ctx.body.mounts || ctx.body.runtimeIdentity || ctx.healthcheck) {
        throw catalogError('Modpack images, environment, storage, and health checks are managed by the panel');
    }
    const { pack, version } = await catalog.selection(input.projectId, input.fileId);
    const java = input.javaVersion ?? version.recommendedJava;
    if (typeof java !== 'number' || ![8, 17, 21, 25].includes(java)) throw catalogError('Select Java 8, 17, 21, or 25');
    if (version.recommendedJava && java < version.recommendedJava) throw catalogError('The selected Java version is too old for this Minecraft release');
    const runtimeIdentity = { user: '1000', uid: 1000, gid: 1000 };
    return {
        provider: 'external',
        catalogId: 'curseforge:' + pack.id,
        dockerImage: 'itzg/minecraft-server:java' + java,
        ports: ctx.ports,
        healthcheck: null,
        resourceLimits: ctx.resourceLimits,
        mounts: [{ key: 'data', containerPath: '/data' }, { key: 'downloads', containerPath: '/downloads' }],
        env: [
            'EULA=TRUE', 'TYPE=AUTO_CURSEFORGE', 'CF_SLUG=' + pack.slug,
            'CF_FILE_ID=' + version.id, 'VERSION=' + version.minecraftVersions[0],
            'MEMORY=' + Math.floor(memoryMb * 0.75) + 'M',
            'INIT_MEMORY=512M', 'UID=1000', 'GID=1000',
            'ENABLE_RCON=true', 'RCON_PASSWORD=' + randomUUID(),
        ],
        runtimeIdentity,
        runtimeConfig: runtimeConfigForIdentity(runtimeIdentity, '/data', '/data'),
        providerMetadata: {
            userProvided: true,
            modpack: {
                platform: 'curseforge', projectId: pack.id, fileId: version.id,
                name: pack.name, version: version.name, minecraftVersion: version.minecraftVersions[0],
                loaders: version.loaders, javaVersion: java, websiteUrl: pack.websiteUrl,
            },
            capabilities: { consoleCommand: true, backup: { supportsCreate: false } },
        },
        steamCredentials: null,
    };
}
