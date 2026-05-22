'use client';

import { useMemo, useState } from 'react';
import type React from 'react';
import type {
  ArmorCatalogEntry,
  ArmorCatalogModlist,
  ArmorCatalogPayload,
  ArmorWeightTier,
} from '@/lib/armorCatalog';

const tierOptions: Array<'All' | ArmorWeightTier> = [
  'All',
  'Clothing',
  'Light',
  'Heavy',
  'Mixed',
  'Unknown',
];

type ViewMode = 'cards' | 'table';

interface ArmorCatalogClientProps {
  entries: ArmorCatalogEntry[];
  modlists: ArmorCatalogModlist[];
  validation: ArmorCatalogPayload['validation'];
  generatedAt: string;
}

export function ArmorCatalogClient({
  entries,
  modlists,
  validation,
  generatedAt,
}: ArmorCatalogClientProps) {
  const [query, setQuery] = useState('');
  const [modlist, setModlist] = useState('All');
  const [tier, setTier] = useState<'All' | ArmorWeightTier>('All');
  const [viewMode, setViewMode] = useState<ViewMode>('cards');

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesQuery =
        !normalizedQuery ||
        [
          entry.displayName,
          entry.canonicalModName,
          entry.nexusModId,
          entry.notes,
          entry.includedInModlists.join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesModlist = modlist === 'All' || entry.includedInModlists.includes(modlist);
      const matchesTier = tier === 'All' || entry.armorWeightTier === tier;
      return matchesQuery && matchesModlist && matchesTier;
    });
  }, [entries, modlist, query, tier]);

  return (
    <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Public entries" value={validation.publicRows} />
        <Stat label="Ready" value={validation.readyPublicRows} />
        <Stat label="Need images" value={validation.missingImages} />
        <Stat label="Unknown tier" value={validation.unknownWeights} />
      </div>

      <div className="rounded-lg border border-bordello-border bg-bordello-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-bordello-muted">
              Search
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Mod name, Nexus ID, notes..."
              className="w-full rounded-md border border-bordello-border bg-bordello-bg px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-bordello-muted focus:border-white/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-bordello-muted">
              Modlist
            </span>
            <select
              value={modlist}
              onChange={(event) => setModlist(event.target.value)}
              className="w-full rounded-md border border-bordello-border bg-bordello-bg px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/40"
            >
              <option value="All">All</option>
              {modlists.map((item) => (
                <option key={item.label} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-bordello-muted">
              Weight
            </span>
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value as 'All' | ArmorWeightTier)}
              className="w-full rounded-md border border-bordello-border bg-bordello-bg px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/40"
            >
              {tierOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-bordello-muted">
              View
            </span>
            <div className="flex rounded-md border border-bordello-border bg-bordello-bg p-1">
              <ToggleButton active={viewMode === 'cards'} onClick={() => setViewMode('cards')}>
                Cards
              </ToggleButton>
              <ToggleButton active={viewMode === 'table'} onClick={() => setViewMode('table')}>
                Table
              </ToggleButton>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-bordello-muted">
          <p>
            Showing <span className="font-semibold text-white">{filteredEntries.length}</span> of{' '}
            {entries.length} entries.
          </p>
          <p>Updated {generatedAt.slice(0, 10)}</p>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredEntries.map((entry) => (
            <ArmorCard key={entry.catalogId} entry={entry} />
          ))}
        </div>
      ) : (
        <ArmorTable entries={filteredEntries} />
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-bordello-border bg-bordello-surface p-4">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm text-bordello-muted">{label}</div>
    </div>
  );
}

function ToggleButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-20 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-bordello-surface text-white' : 'text-bordello-muted hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function ArmorCard({ entry }: { entry: ArmorCatalogEntry }) {
  return (
    <article className="group overflow-hidden rounded-lg border border-bordello-border bg-bordello-surface transition-all hover:-translate-y-0.5 hover:border-white/20">
      <ArmorImage entry={entry} className="h-56 w-full" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-white">
            {entry.displayName}
          </h2>
          <TierBadge tier={entry.armorWeightTier} />
        </div>
        <ModlistBadges labels={entry.includedInModlists} />
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs text-bordello-muted">
            Nexus #{entry.nexusModId || 'unknown'}
          </span>
          {entry.nexusUrl && (
            <a
              href={entry.nexusUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-bordello-border px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-bordello-bg"
            >
              Nexus
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function ArmorImage({ entry, className }: { entry: ArmorCatalogEntry; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!entry.imageUrl || failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-bordello-bg text-sm text-bordello-muted`}>
        Image pending
      </div>
    );
  }

  return (
    <img
      src={entry.imageUrl}
      alt={entry.displayName}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${className} bg-bordello-bg object-cover object-top`}
    />
  );
}

function ArmorTable({ entries }: { entries: ArmorCatalogEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-bordello-border">
      <table className="w-full min-w-[860px] border-collapse bg-bordello-surface text-sm">
        <thead className="bg-bordello-bg text-left text-xs uppercase tracking-wider text-bordello-muted">
          <tr>
            <th className="px-4 py-3 font-semibold">Mod</th>
            <th className="px-4 py-3 font-semibold">Weight</th>
            <th className="px-4 py-3 font-semibold">Modlists</th>
            <th className="px-4 py-3 font-semibold">Nexus</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.catalogId} className="border-t border-bordello-border">
              <td className="px-4 py-3 text-white">{entry.displayName}</td>
              <td className="px-4 py-3">
                <TierBadge tier={entry.armorWeightTier} />
              </td>
              <td className="px-4 py-3">
                <ModlistBadges labels={entry.includedInModlists} />
              </td>
              <td className="px-4 py-3">
                {entry.nexusUrl ? (
                  <a
                    href={entry.nexusUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-white underline underline-offset-4 hover:brightness-125"
                  >
                    #{entry.nexusModId}
                  </a>
                ) : (
                  <span className="text-bordello-muted">Pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TierBadge({ tier }: { tier: ArmorWeightTier }) {
  return (
    <span className="inline-flex shrink-0 rounded border border-bordello-border bg-bordello-bg px-2 py-1 text-xs font-semibold text-bordello-text">
      {tier}
    </span>
  );
}

function ModlistBadges({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded border border-bordello-border bg-bordello-bg px-2 py-0.5 text-xs font-semibold text-bordello-muted"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
