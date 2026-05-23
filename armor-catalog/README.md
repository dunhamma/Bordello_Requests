# Bordello Armor Catalog

This workspace contains a maintainable armor catalog for The Modding Bordello modlists.

## Files

- `data/armor-catalog.csv` is the editable source of truth.
- `docs/data-completion-guide.md` explains how to fill missing weights, URLs, images, and website drop-in data.
- `site/armor-catalog.json` is the structured website artifact.
- `site/armor-catalog.html` is a standalone publishable catalog page.
- `website-dropin/` is a Next.js App Router drop-in shaped for `HerrSchtevie/themoddingbordello`.
- `scripts/build-armor-catalog.mjs` refreshes candidates from public load-order pages, validates the CSV, and regenerates the website artifacts.

## Update Workflow

For the full maintainer workflow, including OS-agnostic MO2 armor weight scanning and missing image/metadata recovery, see `docs/data-completion-guide.md`.

From the `armor-catalog` folder:

```powershell
cd "C:\Users\Admin\Documents\Bordello Requests\armor-catalog"
```

1. Run `node scripts/build-armor-catalog.mjs --refresh` after a major modlist update.
2. Edit `data/armor-catalog.csv` to curate user-facing rows:
   - Set `armor_weight_tier` to `Clothing`, `Light`, `Heavy`, `Mixed`, or `Unknown`.
   - Paste a Nexus screenshot URL into `image_url` when available.
   - Keep patch/conversion/fix rows as non-catalog entries unless they should be shown.
3. Run `node scripts/build-armor-catalog.mjs --build`.
4. Publish `site/armor-catalog.json` and `site/armor-catalog.html`, or copy the HTML into the site.

To enrich rows from the public Nexus Mods Moderator Tools search API:

```powershell
node scripts/build-armor-catalog.mjs --enrich-mod-search --build
```

This fills Nexus thumbnail URLs when the CSV image is blank, records category/summary metadata in `notes`, and only fills `armor_weight_tier` when the mod name or summary explicitly identifies clothing, light armor, heavy armor, or mixed light/heavy variants.

To enrich weight tiers from a local MO2 instance:

```powershell
node scripts/build-armor-catalog.mjs --enrich-mo2 --mo2-instance "D:\Path\To\MO2\Instance" --profile "Default" --build
```

You can also pass explicit paths:

```powershell
node scripts/build-armor-catalog.mjs --enrich-mo2 --mods-path "D:\Path\To\mods" --profile-path "D:\Path\To\profiles\Default" --build
```

The MO2 scanner reads enabled mods from `modlist.txt`, active plugins from `plugins.txt` when present, matches catalog rows by Nexus `modid` from each mod's `meta.ini` or by folder name, then scans plugin `ARMO` records for vanilla `ArmorLight`, `ArmorHeavy`, and `ArmorClothing` keywords.

## Better Nexus Gallery Images

Nexus GraphQL v2 exposes a mod's main image fields, but not an ordered mod-page gallery by mod ID. The gallery images are available in the logged-in Nexus page HTML under `thumbgallery`, so use the bundled userscript from an authenticated browser session:

1. Install `tools/nexus-gallery-harvester.user.js` in Tampermonkey/Violentmonkey.
2. Preview this catalog with `node scripts/serve-site.mjs 4173`.
3. Open `http://127.0.0.1:4173/` in the same browser where Nexus is logged in.
4. Click `Harvest Nexus galleries`.
5. Save the downloaded CSV as `data/nexus-gallery-candidates.csv`.
6. Run:

```powershell
node scripts/build-armor-catalog.mjs --import-gallery-candidates data/nexus-gallery-candidates.csv --build
```

The import prefers gallery image 2 over image 1, records all candidates in `notes`, and updates `image_url` only when a row has no manually reviewed image yet or still uses a search thumbnail. After import, use the catalog page to visually review questionable images.

To preview locally:

```powershell
node scripts/serve-site.mjs 4173
```

Then open `http://127.0.0.1:4173/`.

To install the gallery harvester in your normal Nexus-authenticated browser, open:

```text
http://127.0.0.1:4173/gallery-setup.html
```

On Windows, you can also double-click `start-gallery-server.cmd` from this folder. It serves the setup page and catalog preview at:

```text
http://127.0.0.1:4174/gallery-setup.html
```

From the repo root, use the folder-prefixed script path instead:

```powershell
node armor-catalog/scripts/serve-site.mjs 4173
```

## The Modding Bordello Website Drop-in

The current website is a Next.js App Router project with Tailwind `bordello` colors and content files under `content/`. After running `node scripts/build-armor-catalog.mjs --build`, copy these files from `website-dropin/` into Schtevie's website repo:

```text
app/armor-catalog/page.tsx
components/armor/ArmorCatalogClient.tsx
lib/armorCatalog.ts
content/armor-catalog/armor-catalog.json
content/armor-catalog/armor-catalog.csv
```

Optionally add `{ label: 'Armor Catalog', href: '/armor-catalog' }` to the website's `components/nav/GlobalNav.tsx` `navItems` array.

## Nexus Images

The public page does not make Nexus API calls. Image URLs are stored in the CSV and copied into the generated JSON/HTML.

For private build-time enrichment, set `NEXUS_API_KEY` and run:

```powershell
node scripts/build-armor-catalog.mjs --enrich-nexus --build
```

That optional step uses Nexus metadata as a fallback when `image_url` is blank. Curated screenshot URLs should still be preferred when selecting the second or best representative image from a Nexus page.
