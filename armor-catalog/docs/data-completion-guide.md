# Armor Catalog Data Completion Guide

This guide is for Schtevie or anyone maintaining the armor catalog after a modlist update. The catalog source is `data/armor-catalog.csv`; generated website files should be treated as build output.

## Requirements

- Node.js 20 or newer.
- A local checkout of this repository.
- Optional: a local Mod Organizer 2 instance for the modlist being scanned.
- Optional: a Nexus API key for fallback Nexus metadata.
- Optional: a Nexus-authenticated browser for gallery image harvesting.

All commands below run from the `armor-catalog` folder:

```sh
cd /path/to/Bordello_Requests/armor-catalog
```

On Windows PowerShell, the same command shape works:

```powershell
cd "C:\Path\To\Bordello_Requests\armor-catalog"
```

## Normal Update Pass

Refresh candidates from the public load-order pages and rebuild artifacts:

```sh
node scripts/build-armor-catalog.mjs --refresh
```

Run public metadata enrichment:

```sh
node scripts/build-armor-catalog.mjs --enrich-mod-search --build
```

Review the validation output. Warnings are expected while curation is incomplete; errors should be fixed before shipping.

Build after manual CSV edits:

```sh
node scripts/build-armor-catalog.mjs --build
```

Generated outputs:

- `site/armor-catalog.json`
- `site/armor-catalog.html`
- `website-dropin/content/armor-catalog/armor-catalog.json`
- `website-dropin/content/armor-catalog/armor-catalog.csv`

## Armor Weight Tiers From MO2

The MO2 scanner is OS-agnostic. It only needs:

- the MO2 `mods` directory
- the MO2 profile directory containing `modlist.txt` and, ideally, `plugins.txt`

It does not require a running MO2 process. It reads enabled mods, matches catalog rows by Nexus `modid` from each mod's `meta.ini` or by folder name, then scans plugin `ARMO` records for vanilla armor keywords:

- `ArmorClothing`
- `ArmorLight`
- `ArmorHeavy`

The scanner writes one of:

- `Clothing`
- `Light`
- `Heavy`
- `Mixed`
- `Unknown`

### Preferred Generic Command

Use explicit paths when the MO2 layout is custom, portable, on a network drive, or under Wine/Proton:

```sh
node scripts/build-armor-catalog.mjs --enrich-mo2 --mods-path "/path/to/MO2/mods" --profile-path "/path/to/MO2/profiles/Default" --build
```

PowerShell example:

```powershell
node scripts/build-armor-catalog.mjs --enrich-mo2 --mods-path "D:\Wabbajack\modlists\Example\mods" --profile-path "D:\Wabbajack\modlists\Example\profiles\Default" --build
```

macOS/Linux/Wine-style example:

```sh
node scripts/build-armor-catalog.mjs --enrich-mo2 --mods-path "$HOME/Games/mo2/instances/Example/mods" --profile-path "$HOME/Games/mo2/instances/Example/profiles/Default" --build
```

### MO2 Instance Shortcut

If the MO2 instance follows the standard structure:

```text
<instance>/
  mods/
  profiles/
    <profile>/
      modlist.txt
      plugins.txt
```

then use:

```sh
node scripts/build-armor-catalog.mjs --enrich-mo2 --mo2-instance "/path/to/MO2/instance" --profile "Default" --build
```

PowerShell example:

```powershell
node scripts/build-armor-catalog.mjs --enrich-mo2 --mo2-instance "D:\Wabbajack\modlists\Example" --profile "Default" --build
```

### Environment Variable Option

These are useful for repeated runs:

```sh
MO2_MODS_PATH="/path/to/MO2/mods" MO2_PROFILE_PATH="/path/to/MO2/profiles/Default" node scripts/build-armor-catalog.mjs --enrich-mo2 --build
```

PowerShell:

```powershell
$env:MO2_MODS_PATH = "D:\Wabbajack\modlists\Example\mods"
$env:MO2_PROFILE_PATH = "D:\Wabbajack\modlists\Example\profiles\Default"
node scripts/build-armor-catalog.mjs --enrich-mo2 --build
```

Shortcut variable form:

```sh
MO2_INSTANCE_PATH="/path/to/MO2/instance" MO2_PROFILE="Default" node scripts/build-armor-catalog.mjs --enrich-mo2 --build
```

PowerShell:

```powershell
$env:MO2_INSTANCE_PATH = "D:\Wabbajack\modlists\Example"
$env:MO2_PROFILE = "Default"
node scripts/build-armor-catalog.mjs --enrich-mo2 --build
```

### MO2 Scanner Limits

- It can only infer weight tiers from plugin armor records with vanilla clothing/light/heavy keywords.
- Mesh-only outfits with no plugin data may remain `Unknown`.
- SPID/KID distribution mods, patches, fixes, Bodyslide packages, and body conversions should usually stay non-public or linked back to parent catalog items.
- If a mod has both light and heavy variants, or armor plus clothing records, it becomes `Mixed`.
- Existing manually reviewed tiers are preserved unless the row is still `Unknown`, has a prior inferred tier note, or already has an MO2 scan note.

## Nexus URL And Metadata Gaps

The public load-order refresh usually captures Nexus URLs already. For rows that still need metadata, run:

```sh
node scripts/build-armor-catalog.mjs --enrich-mod-search --build
```

This uses the public Nexus Mods Moderator Tools search API. It can fill:

- thumbnail images when `image_url` is blank
- explicit weight tiers when the summary/category clearly says clothing, light armor, heavy armor, or mixed variants
- notes with category/summary context

For Nexus API fallback metadata, set `NEXUS_API_KEY` privately. Do not commit the key or expose it in website code.

```sh
NEXUS_API_KEY="your-key-here" node scripts/build-armor-catalog.mjs --enrich-nexus --build
```

PowerShell:

```powershell
$env:NEXUS_API_KEY = "your-key-here"
node scripts/build-armor-catalog.mjs --enrich-nexus --build
```

## Missing Or Bad Images

The public website does not call Nexus at runtime. Image URLs live in the CSV/JSON.

### Gallery Harvest Flow

Start the local preview:

```sh
node scripts/serve-site.mjs 4174
```

Windows convenience launcher:

```powershell
.\start-gallery-server.cmd
```

Open:

```text
http://127.0.0.1:4174/gallery-setup.html
```

Use a browser that is logged into Nexus Mods. Install or update `tools/nexus-gallery-harvester.user.js` in Tampermonkey/Violentmonkey. In current Edge/Chrome builds, also enable one of:

- Tampermonkey extension details -> `Allow User Scripts`
- Browser extensions page -> `Developer mode`

Then open:

```text
http://127.0.0.1:4174/
```

Click `Harvest Nexus galleries` and save the downloaded file as:

```text
data/nexus-gallery-candidates.csv
```

Import it:

```sh
node scripts/build-armor-catalog.mjs --import-gallery-candidates data/nexus-gallery-candidates.csv --build
```

The import prefers gallery image rank `2`, falls back to rank `1`, records candidates in `notes`, and only replaces blank/search-thumbnail/primary-metadata images. Manually curated image URLs are preserved.

### Manual Image Fixes

If the gallery tool misses a mod or picks a bad title-card image:

1. Open the Nexus page from `nexus_url`.
2. Choose a representative armor/clothing screenshot.
3. Paste the direct image URL into `image_url`.
4. Put the Nexus page or image page into `image_source_url`.
5. Set `image_rank` to a clear value such as `manual-gallery-3`.
6. Run:

```sh
node scripts/build-armor-catalog.mjs --build
```

## Manual CSV Review Checklist

For public rows where `entry_type` is `Catalog Item` and `status` is not `Deprecated`, each shipped entry should have:

- `display_name`
- `armor_weight_tier`
- `nexus_url`
- `image_url`
- `included_in_modlists`

Use these statuses:

- `Needs URL`
- `Needs Weight`
- `Needs Image`
- `Ready`
- `Deprecated`

Use these public/non-public types:

- `Catalog Item`
- `Patch`
- `Bodyslide/Body Conversion`
- `Distribution`
- `Fix`
- `Dependency`

Only `Catalog Item` rows appear in the public catalog by default.

## Website Drop-in

After the catalog is built, copy these files from `website-dropin/` into `HerrSchtevie/themoddingbordello`:

```text
app/armor-catalog/page.tsx
components/armor/ArmorCatalogClient.tsx
lib/armorCatalog.ts
content/armor-catalog/armor-catalog.json
content/armor-catalog/armor-catalog.csv
```

Optional nav link in `components/nav/GlobalNav.tsx`:

```ts
{ label: 'Armor Catalog', href: '/armor-catalog' },
```

Then run the website's normal checks:

```sh
npm install
npm run build
```

## Recommended Full Maintenance Sequence

```sh
cd /path/to/Bordello_Requests/armor-catalog
node scripts/build-armor-catalog.mjs --refresh
node scripts/build-armor-catalog.mjs --enrich-mod-search --build
node scripts/build-armor-catalog.mjs --enrich-mo2 --mods-path "/path/to/MO2/mods" --profile-path "/path/to/MO2/profiles/Default" --build
node scripts/build-armor-catalog.mjs --import-gallery-candidates data/nexus-gallery-candidates.csv --build
node scripts/build-armor-catalog.mjs --build
```

Skip the gallery import command until `data/nexus-gallery-candidates.csv` exists.
