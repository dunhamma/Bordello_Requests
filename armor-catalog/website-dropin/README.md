# The Modding Bordello Website Drop-in

These files are shaped for `HerrSchtevie/themoddingbordello`, which is a Next.js App Router site using Tailwind `bordello` colors and content files under `content/`.

## Copy Targets

Copy these folders into the website repo root:

```text
website-dropin/app/armor-catalog/page.tsx -> app/armor-catalog/page.tsx
website-dropin/components/armor/ArmorCatalogClient.tsx -> components/armor/ArmorCatalogClient.tsx
website-dropin/lib/armorCatalog.ts -> lib/armorCatalog.ts
website-dropin/content/armor-catalog/armor-catalog.json -> content/armor-catalog/armor-catalog.json
website-dropin/content/armor-catalog/armor-catalog.csv -> content/armor-catalog/armor-catalog.csv
```

Optional nav addition in `components/nav/GlobalNav.tsx`:

```ts
{ label: 'Armor Catalog', href: '/armor-catalog' },
```

Place it in the existing `navItems` array wherever Schtevie wants the catalog to appear.

## Update Flow

The editable source stays in this project at `data/armor-catalog.csv`.

From `armor-catalog/`:

```powershell
node scripts/build-armor-catalog.mjs --build
```

That regenerates both:

- `site/armor-catalog.json` for the standalone artifact.
- `website-dropin/content/armor-catalog/armor-catalog.json` for the Next site.
- `website-dropin/content/armor-catalog/armor-catalog.csv` as the curation source copy.

The public website route reads only the generated JSON. It makes no runtime Nexus API calls and uses plain `<img>` tags so Schtevie does not need to change `next.config.mjs` remote image settings.
