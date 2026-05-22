import type { Metadata } from 'next';
import { ArmorCatalogClient } from '@/components/armor/ArmorCatalogClient';
import { getArmorCatalog } from '@/lib/armorCatalog';

export const metadata: Metadata = {
  title: 'Armor Catalog | The Modding Bordello',
  description:
    'A searchable catalog of armor, clothing, and outfit mods included across The Modding Bordello modlists.',
};

export default async function ArmorCatalogPage() {
  const catalog = await getArmorCatalog();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <header className="mb-8 border-b border-bordello-border pb-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-bordello-muted">
          All Modlists
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white">
          Armor Catalog
        </h1>
        <p className="mt-3 max-w-3xl text-bordello-muted leading-relaxed">
          Browse armor, clothing, and outfit mods included across JOJ, TOT, HOH, MOM, DOD,
          and VOV. Each entry links back to Nexus and carries its curated weight tier.
        </p>
      </header>

      <ArmorCatalogClient
        entries={catalog.entries}
        modlists={catalog.modlists}
        validation={catalog.validation}
        generatedAt={catalog.generatedAt}
      />
    </div>
  );
}
