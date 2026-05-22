import fs from 'node:fs/promises';
import path from 'node:path';

export type ArmorWeightTier = 'Clothing' | 'Light' | 'Heavy' | 'Mixed' | 'Unknown';

export interface ArmorCatalogModlist {
  slug: string;
  label: string;
  name: string;
}

export interface ArmorCatalogEntry {
  catalogId: string;
  displayName: string;
  canonicalModName: string;
  armorWeightTier: ArmorWeightTier;
  nexusUrl: string;
  nexusGameDomain: string;
  nexusModId: string;
  imageUrl: string;
  imageSourceUrl: string;
  imageRank: string;
  includedInModlists: string[];
  sourceSections: string[];
  sourceVersions: string[];
  status: string;
  notes: string;
  lastVerified: string;
}

export interface ArmorCatalogPayload {
  generatedAt: string;
  source: string;
  modlists: ArmorCatalogModlist[];
  validation: {
    totalRows: number;
    publicRows: number;
    readyPublicRows: number;
    missingImages: number;
    unknownWeights: number;
    needsUrl: number;
  };
  entries: ArmorCatalogEntry[];
}

export async function getArmorCatalog(): Promise<ArmorCatalogPayload> {
  const filePath = path.join(process.cwd(), 'content', 'armor-catalog', 'armor-catalog.json');
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as ArmorCatalogPayload;
}
