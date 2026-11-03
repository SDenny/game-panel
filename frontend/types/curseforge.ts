// Copyright 2026 Game Panel contributors. SPDX-License-Identifier: Apache-2.0
export interface CurseForgePack {
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
}

export interface CurseForgeVersion {
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
}

export interface CatalogPage<T> {
  items: T[];
  offset: number;
  total: number;
  nextOffset: number | null;
}

export interface ModpackInstallSelection {
  platform: 'curseforge';
  projectId: number;
  fileId: number;
  javaVersion: number;
  acceptEula: boolean;
}
