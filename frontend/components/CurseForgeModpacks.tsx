// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Download, ExternalLink, Package, Search } from 'lucide-react';
import { apiClient } from '../utils/api';
import type { CatalogPage, CurseForgePack, CurseForgeVersion } from '../types/curseforge';
import type { InstallGameHandlerPayload } from './app/appActionHandlers';
import { AppButton } from '../src/ui/components';

const inputClass = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gp-surface-input px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--gp-ods-accent-primary)]';
const mutedClass = 'text-sm text-gray-500 dark:text-gray-400';
const cardClass = 'rounded-xl border border-gray-200 dark:border-gray-700/50 bg-gp-surface-elevated p-4';

function errorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error || 'The request failed. Please try again.';
}

function PackArtwork({ pack }: { pack: CurseForgePack }) {
  return pack.iconUrl
    ? <img src={pack.iconUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />
    : <Package className="h-14 w-14 shrink-0 rounded-lg bg-gray-500/10 p-3 text-gray-400" aria-hidden="true" />;
}

function uniqueName(name: string, usedNames: string[]): string {
  const base = name.slice(0, 44);
  const used = new Set(usedNames.map(value => value.toLowerCase()));
  let result = base;
  let suffix = 1;
  while (used.has(result.toLowerCase())) result = base + ' (' + suffix++ + ')';
  return result;
}

interface Props {
  onBack: () => void;
  onInstall: (payload: InstallGameHandlerPayload) => Promise<void>;
  canInstall: boolean;
  usedPorts?: { tcp: number[]; udp: number[] };
  usedServerNames?: string[];
}

function ModpackDetails({ pack, onBack, onInstall, canInstall, usedPorts, usedServerNames = [] }: Props & { pack: CurseForgePack }) {
  const [versions, setVersions] = useState<CurseForgeVersion[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [javaVersion, setJavaVersion] = useState<number>(17);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(() => uniqueName(pack.name, usedServerNames));
  const [port, setPort] = useState(() => {
    let value = 25565;
    const used = new Set(usedPorts?.tcp ?? []);
    while (used.has(value) && value < 65535) value++;
    return String(value);
  });
  const [memory, setMemory] = useState('6144');
  const [cpu, setCpu] = useState('2');
  const [acceptEula, setAcceptEula] = useState(false);
  const selectedVersion = versions.find(version => version.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiClient.getCurseForgeVersions(pack.id, offset, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setVersions(previous => offset === 0 ? result.versions.items : [
        ...previous, ...result.versions.items.filter(version => !previous.some(item => item.id === version.id)),
      ]);
      setNextOffset(result.versions.nextOffset);
      if (offset === 0) {
        const recommended = result.versions.items.find(version => version.installable && version.releaseType === 'release')
          ?? result.versions.items.find(version => version.installable);
        setSelectedId(recommended?.id ?? null);
        setJavaVersion(recommended?.recommendedJava ?? 17);
      }
    }).catch(reason => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [pack.id, offset, retry]);

  async function install(event: FormEvent) {
    event.preventDefault();
    if (submitting || loading || !canInstall || !selectedVersion?.installable || !acceptEula) return;
    const cleanName = name.trim();
    const hostPort = Number(port);
    const memoryMb = Number(memory);
    const cpuLimit = Number(cpu);
    if (cleanName.length < 3 || cleanName.length > 50) { setError('Use a server name between 3 and 50 characters.'); return; }
    if (usedServerNames.some(value => value.toLowerCase() === cleanName.toLowerCase())) { setError('A server already uses this name. Choose another name.'); return; }
    if (!Number.isInteger(hostPort) || hostPort < 1025 || hostPort > 65535 || usedPorts?.tcp.includes(hostPort)) { setError('Choose an available TCP port between 1025 and 65535.'); return; }
    if (!Number.isInteger(memoryMb) || memoryMb < 2048 || memoryMb > 262144 || !Number.isFinite(cpuLimit) || cpuLimit < 0.1) { setError('Choose at least 2048 MB of memory and 0.1 CPU.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await onInstall({
        provider: 'external', name: cleanName,
        ports: { tcp: [{ host: hostPort, container: 25565, label: 'Minecraft' }], udp: [] },
        healthcheck: null, resourceLimits: { memoryMb, cpu: cpuLimit },
        modpack: { platform: 'curseforge', projectId: pack.id, fileId: selectedVersion.id, javaVersion, acceptEula },
      });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-5">
      <AppButton tone="ghost" onClick={onBack} disabled={submitting}><ArrowLeft className="mr-2 h-4 w-4" /> Back to modpacks</AppButton>
      <div className="flex items-start gap-4">
        <PackArtwork pack={pack} />
        <div className="min-w-0">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{pack.name}</h3>
          <p className={mutedClass}>By {pack.authors.join(', ')}</p>
          <a className="mt-1 inline-flex items-center gap-1 text-sm text-[var(--gp-ods-accent-primary)] underline" href={pack.websiteUrl} target="_blank" rel="noreferrer">View on CurseForge <ExternalLink className="h-3 w-3" /></a>
        </div>
      </div>
      <p className={mutedClass}>{pack.summary}</p>

      <form className="space-y-5" onSubmit={install}>
        <section className={cardClass + ' space-y-3'} aria-label="Modpack version">
          <label className="block space-y-2 text-sm font-medium text-gray-900 dark:text-white">
            <span>Pack version</span>
            <select className={inputClass} value={selectedId ?? ''} disabled={loading || submitting || versions.length === 0} onChange={event => {
              const version = versions.find(item => item.id === Number(event.target.value));
              setSelectedId(version?.id ?? null);
              setJavaVersion(version?.recommendedJava ?? 17);
            }}>
              <option value="" disabled>{loading && !versions.length ? 'Loading versions…' : 'Choose a version'}</option>
              {versions.map(version => <option key={version.id} value={version.id} disabled={!version.installable}>
                {version.name} · {version.releaseType}{!version.installable ? ' · unavailable' : ''}
              </option>)}
            </select>
          </label>
          {selectedVersion && (
            <div className={mutedClass + ' space-y-1'}>
              <p>Minecraft <strong>{selectedVersion.minecraftVersions.join(', ')}</strong> · {selectedVersion.loaders.join(' / ') || 'Mod loader resolved from pack manifest'}</p>
              <p>The installer uses the exact mod loader version supplied by the pack.</p>
              <p>Released {new Date(selectedVersion.releasedAt).toLocaleDateString()} · This pack version stays pinned across restarts.</p>
            </div>
          )}
          {!loading && !versions.length && !error && <p className={mutedClass}>No modpack releases were found on this page.</p>}
          {versions.some(version => !version.installable) && <p className="text-sm text-amber-700 dark:text-amber-300">Some versions cannot be installed automatically. They may restrict downloads or have incomplete compatibility information.</p>}
          {nextOffset !== null && <AppButton tone="neutral" disabled={loading || submitting} onClick={() => { setLoading(true); setOffset(nextOffset); }}>Load older versions</AppButton>}
          {loading && <p role="status" className={mutedClass}>Loading versions…</p>}
          <label className="block space-y-2 text-sm font-medium text-gray-900 dark:text-white">
            <span>Java runtime</span>
            <select className={inputClass} value={javaVersion} disabled={submitting || !selectedVersion} onChange={event => setJavaVersion(Number(event.target.value))}>
              {[8, 17, 21, 25].map(version => <option key={version} value={version} disabled={Boolean(selectedVersion?.recommendedJava && version < selectedVersion.recommendedJava)}>
                Java {version}{version === selectedVersion?.recommendedJava ? ' (recommended)' : ''}
              </option>)}
            </select>
          </label>
        </section>

        <section className={cardClass + ' space-y-4'} aria-label="New server settings">
          <h4 className="font-semibold text-gray-900 dark:text-white">New server</h4>
          <label className="block space-y-2 text-sm text-gray-900 dark:text-white">
            <span>Server name</span>
            <input className={inputClass} value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={50} required disabled={submitting} />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="space-y-2 text-sm text-gray-900 dark:text-white"><span>Game port</span><input className={inputClass} type="number" min={1025} max={65535} value={port} onChange={event => setPort(event.target.value)} required disabled={submitting} /></label>
            <label className="space-y-2 text-sm text-gray-900 dark:text-white"><span>Memory (MB)</span><input className={inputClass} type="number" min={2048} max={262144} step={128} value={memory} onChange={event => setMemory(event.target.value)} required disabled={submitting} /></label>
            <label className="space-y-2 text-sm text-gray-900 dark:text-white"><span>CPU limit</span><input className={inputClass} type="number" min={0.1} step={0.1} value={cpu} onChange={event => setCpu(event.target.value)} required disabled={submitting} /></label>
          </div>
          <p className={mutedClass}>Creates a separate server with its own world and files. Large modpacks may need more memory.</p>
        </section>
        <p className={mutedClass}>Some authors require individual files to be downloaded manually. If installation pauses, the server log will list the files to upload.</p>
        <label className="flex items-start gap-3 text-sm text-gray-900 dark:text-white">
          <input type="checkbox" className="mt-1" checked={acceptEula} onChange={event => setAcceptEula(event.target.checked)} disabled={submitting} />
          <span>I agree to the <a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer" className="underline">Minecraft EULA</a>.</span>
        </label>
        {error && <div role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"><p>{error}</p><AppButton tone="ghost" onClick={() => setRetry(value => value + 1)} disabled={loading || submitting}>Retry loading versions</AppButton></div>}
        <AppButton type="submit" tone="primary" fullWidth disabled={!canInstall || submitting || loading || !selectedVersion?.installable || !acceptEula}>
          <Download className="mr-2 h-4 w-4" />{submitting ? 'Creating server…' : 'Install modpack'}
        </AppButton>
      </form>
    </div>
  );
}

export function CurseForgeModpacks(props: Props) {
  const [selectedPack, setSelectedPack] = useState<CurseForgePack | null>(null);
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CatalogPage<CurseForgePack> | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      const status = await apiClient.getCurseForgeStatus(controller.signal);
      if (controller.signal.aborted) return;
      setConfigured(status.configured);
      if (status.configured) {
        const result = await apiClient.searchCurseForgeModpacks({ query, sort, offset }, controller.signal);
        if (!controller.signal.aborted) setData(result);
      }
    })().catch(reason => {
      if (!controller.signal.aborted) setError(errorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [query, sort, offset, retry]);

  if (selectedPack) return <ModpackDetails key={selectedPack.id} {...props} pack={selectedPack} onBack={() => setSelectedPack(null)} />;

  return (
    <div className="space-y-5">
      <AppButton tone="ghost" onClick={props.onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Back to games</AppButton>
      <div><h3 className="text-xl font-semibold text-gray-900 dark:text-white">CurseForge modpacks</h3><p className={mutedClass}>Find a pack, choose a version, and create a Minecraft server.</p></div>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setOffset(0); setQuery(draftQuery.trim()); setSort(draftQuery.trim() ? 'relevance' : 'popular'); setRetry(value => value + 1); }}>
        <label className="min-w-0 flex-1"><span className="sr-only">Search modpacks</span><input className={inputClass} placeholder="Search modpacks, e.g. RLCraft" maxLength={100} value={draftQuery} onChange={event => setDraftQuery(event.target.value)} /></label>
        <AppButton type="submit" tone="primary" disabled={loading || configured === false}><Search className="mr-2 h-4 w-4" /> Search</AppButton>
        <label><span className="sr-only">Sort modpacks</span><select className={inputClass} value={sort} onChange={event => { setOffset(0); setSort(event.target.value); }} disabled={configured === false}><option value="popular">Most downloaded</option><option value="relevance">Relevance</option><option value="updated">Recently updated</option></select></label>
      </form>
      {loading && <p role="status" className={mutedClass}>Loading CurseForge modpacks…</p>}
      {!loading && configured === false && <div className={cardClass}><h4 className="font-semibold text-gray-900 dark:text-white">Connect CurseForge</h4><p className={mutedClass}>Ask your panel administrator to configure a CurseForge API key to enable browsing and installation.</p><AppButton className="mt-3" onClick={() => setRetry(value => value + 1)}>Check connection</AppButton></div>}
      {error && <div role="alert" className="rounded-lg bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300"><p>{error}</p><AppButton className="mt-2" onClick={() => setRetry(value => value + 1)}>Try again</AppButton></div>}
      {!loading && data && data.items.length === 0 && <p className={mutedClass}>No modpacks found. Try a different search.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data?.items.map(pack => <article key={pack.id} className={cardClass + ' flex flex-col gap-3'}>
          <div className="flex items-start gap-3"><PackArtwork pack={pack} /><div className="min-w-0"><h4 className="font-semibold text-gray-900 dark:text-white">{pack.name}</h4><p className="text-xs text-gray-500 dark:text-gray-400">By {pack.authors.join(', ')}</p></div></div>
          <p className={mutedClass + ' line-clamp-3 flex-1'}>{pack.summary}</p>
          <div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500 dark:text-gray-400">{new Intl.NumberFormat(undefined, { notation: 'compact' }).format(pack.downloads)} downloads</span><AppButton tone="primary" disabled={!props.canInstall || !pack.available || !pack.distributionAllowed} onClick={() => setSelectedPack(pack)}>Select <ArrowRight className="ml-2 h-3 w-3" /></AppButton></div>
          {(!pack.available || !pack.distributionAllowed) && <p className="text-xs text-amber-700 dark:text-amber-300">Automatic installation is unavailable for this pack.</p>}
        </article>)}
      </div>
      {data && <nav aria-label="Modpack pages" className="flex items-center justify-between gap-2">
        <AppButton disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</AppButton>
        <span className="text-xs text-gray-500 dark:text-gray-400">{data.total.toLocaleString()} modpacks</span>
        <AppButton disabled={loading || data.nextOffset === null} onClick={() => { if (data.nextOffset !== null) setOffset(data.nextOffset); }}>Next</AppButton>
      </nav>}
    </div>
  );
}
