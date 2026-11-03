import type { ProviderInstallContext, ResolvedInstallSpec } from './installTypes.js';
import { resolveExternalInstallSpec } from './external/installSpec.js';
import { resolveLinuxGsmInstallSpec } from './linuxgsm/installSpec.js';
import { resolveOvhcloudInstallSpec } from './ovhcloud/installSpec.js';
import type { ServerProvider } from './types.js';
import { resolveCurseForgeInstallSpec } from './external/curseforgeInstall.js';

export async function resolveInstallSpec(params: ProviderInstallContext & {
    provider: ServerProvider;
}): Promise<ResolvedInstallSpec> {
    if (params.body.modpack !== undefined) {
        if (params.provider !== 'external') {
            throw Object.assign(new Error('Modpack installs use the external provider'), { statusCode: 400 });
        }
        return resolveCurseForgeInstallSpec(params);
    }
    if (params.provider === 'linuxgsm') {
        return resolveLinuxGsmInstallSpec(params);
    }

    if (params.provider === 'external') {
        return resolveExternalInstallSpec(params);
    }

    return resolveOvhcloudInstallSpec(params);
}
