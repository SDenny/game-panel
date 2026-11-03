// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { installProgressRepository, serverRepository } from '../database/index.js';
import { docker } from '../utils/docker/client.js';
import { getContainerLogs, inspectContainerRuntime } from '../utils/docker.js';
import { waitForModpackReady, isCurseForgeServer } from '../providers/external/curseforgeRuntime.js';
import { assertServerExistsDuringInstall } from './serverActionPolicy.js';
import { beginServerTransition, completeServerTransition, clearServerTransition } from './serverTransitions.js';
import { logError } from '../utils/logger.js';

const active = new Map<number, Promise<void>>();

async function monitorStartup(serverId: number, containerId: string): Promise<void> {
    await beginServerTransition(serverId, 'installing', { timeoutMs: 46 * 60_000, timeoutBehavior: 'reconcile' });
    await waitForModpackReady({
        inspect: () => inspectContainerRuntime(containerId),
        logs: () => getContainerLogs(containerId, 80),
        assertExists: async () => {
            await assertServerExistsDuringInstall(serverId);
            const server = await serverRepository.findById(serverId);
            if (server?.desired_state === 'stopped') throw new Error('Installation was stopped. Start this server to resume.');
        },
        onStage: stage => installProgressRepository.update(serverId, stage === 'downloading_server_files' ? 80 : 95, stage),
    });
    await assertServerExistsDuringInstall(serverId);
    await docker.getContainer(containerId).update({ RestartPolicy: { Name: 'unless-stopped' } });
    await completeServerTransition(serverId, 'running');
}

export function trackCurseForgeStartup(serverId: number, containerId: string): Promise<void> {
    const existing = active.get(serverId);
    if (existing) return existing;
    const pending = monitorStartup(serverId, containerId).finally(() => active.delete(serverId));
    active.set(serverId, pending);
    return pending;
}

// Called after a panel restart, or after Start is used to resume a failed pack.
// Keep one monitor per server and retain the existing world/download directories.
const resumed = new Set<number>();
export async function resumeCurseForgeTracking(serverId: number): Promise<void> {
    if (resumed.has(serverId) || active.has(serverId)) return;
    resumed.add(serverId);
    try {
        const server = await serverRepository.findById(serverId);
        if (!server || !server.docker_container_id || !isCurseForgeServer(server)) return;
        const progress = await installProgressRepository.getByServerId(serverId);
        if (!progress || progress.status === 'completed') return;
        await trackCurseForgeStartup(serverId, server.docker_container_id);
        await installProgressRepository.update(serverId, 100, 'completed');
    } catch (error) {
        clearServerTransition(serverId);
        if (await serverRepository.findById(serverId)) {
            const message = error instanceof Error ? error.message : 'Modpack installation failed';
            await serverRepository.markFailed(serverId, message);
            await installProgressRepository.update(serverId, 0, 'failed', message);
        }
    } finally { resumed.delete(serverId); }
}

export async function resumeInterruptedCurseForgeInstalls(): Promise<void> {
    for (const server of await serverRepository.listAll()) {
        if (isCurseForgeServer(server)) {
            const progress = await installProgressRepository.getByServerId(server.id);
            if (progress && !['completed', 'failed'].includes(progress.status)) {
                if (server.docker_container_id) {
                    void resumeCurseForgeTracking(server.id).catch(error => logError('CURSEFORGE:RESUME', error, { serverId: server.id }));
                } else {
                    const message = 'The panel restarted before the modpack container was created. Remove this incomplete server and install the pack again.';
                    await serverRepository.markFailed(server.id, message);
                    await installProgressRepository.update(server.id, 0, 'failed', message);
                }
            }
        }
    }
}
