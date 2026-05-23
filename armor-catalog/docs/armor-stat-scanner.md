# Bordello Armor Stat Scanner

This guide is for people who have never run a repository tool before. It walks you from "I have a Wabbajack/MO2 modlist installed" to "I have a CSV I can open in Excel or Google Sheets."

Use `tools/bordello_armor_stat_scanner.py` when you want a raw CSV of armor records from locally installed MO2/Wabbajack lists. This is separate from the curated public catalog CSV; it exports plugin-level `ARMO` data for review.

## What You Get

Each row is one `ARMO` record from an active plugin in an enabled MO2 mod:

- MO2 instance, profile, mod folder, plugin, and FormID
- editor ID and display name when available
- armor category from `BOD2/BODT` and vanilla category keywords
- armor rating, value, and weight
- biped slots
- keyword EDIDs and raw keyword FormIDs
- inferred material keywords such as `ArmorMaterial*`
- vendor and armor-slot keywords
- enchantment/template FormIDs and model paths when present

The scanner intentionally has no third-party dependencies.

## Before You Start

You need three things:

1. This repository on your computer.
2. Python 3.10 or newer.
3. A locally installed Wabbajack/MO2 list with `mods` and `profiles` folders.

The examples below use Windows PowerShell. Open PowerShell from the Start menu, then paste commands one at a time.

## Requirements

- Python 3.10 or newer. Download it from `https://www.python.org/downloads/` if `python --version` and `py -3 --version` both fail.
- A local MO2/Wabbajack install of the list you want to scan. A normal Wabbajack install usually looks like `D:\Wabbajack\modlists\DoD`.
- Optional: your Skyrim Special Edition `Data` folder path. The scanner auto-detects `<instance>\Stock Game\Data` when present; otherwise `--game-data` lets it resolve vanilla keyword names from `Skyrim.esm`, `Update.esm`, and the DLC masters.

Check Python:

```powershell
python --version
```

If that fails, try:

```powershell
py -3 --version
```

If both fail, install Python and make sure the installer option `Add python.exe to PATH` is checked.

PowerShell examples below assume this repository is at:

```powershell
cd "C:\Users\Admin\Documents\Bordello Requests\armor-catalog"
```

If your checkout is somewhere else, replace that path with your own `armor-catalog` folder.

The commands use `python`. On Windows, `py -3` is also fine; replace `python` with `py -3` in any command if needed.

## Find Your Modlist Folder

Open File Explorer and find the installed Wabbajack/MO2 list. The folder must contain both:

```text
mods
profiles
```

Common examples:

```text
D:\Wabbajack\modlists\DoD
D:\Wabbajack\modlists\Anvil
C:\Wabbajack\modlists\Some List Name
```

If you are not sure which profile to use, open the `profiles` folder. Each folder inside it is a profile name. You can copy the exact folder name into `--profile`.

## First Test Run

From the `armor-catalog` folder, run help first. This confirms Python can see the script.

```powershell
python tools\bordello_armor_stat_scanner.py --help
```

If help text appears, the script is ready.

## Included Sample Output

The repo includes a real smoke-tested scanner output:

```text
examples\dod-daedric-armor-stats-smoke.csv
```

It was generated from the local DoD install with this command:

```powershell
python tools\bordello_armor_stat_scanner.py `
  --mo2-instance "D:\Wabbajack\modlists\DoD" `
  --profile "Diaries of Dibella - Lord's Vision" `
  --filter "daedric" `
  --output "examples\dod-daedric-armor-stats-smoke.csv"
```

Smoke-test result:

- Active plugins scanned: `3,830`
- Total `ARMO` records parsed before filtering: `37,121`
- Sample rows exported after `daedric` filter: `1,433`

Open this file first if you want to see what the finished CSV should look like before scanning your own list.

## Scan One Installed List

Use the actual folder name on disk. The public Bordello labels are currently JOJ, TOT, HOH, MOM, DOD, and VOV, but local Wabbajack/MO2 folder names may differ.

Start with one list. Replace the instance path and profile name with yours:

```powershell
python tools\bordello_armor_stat_scanner.py `
  --mo2-instance "D:\Wabbajack\modlists\DoD" `
  --profile "Default" `
  --output "data\dod-armor-stats.csv"
```

If the profile is not named `Default`, open the instance's `profiles` folder and use that folder name.

When it finishes, open:

```text
data\dod-armor-stats.csv
```

You can open the CSV in Excel, Google Sheets, LibreOffice, or any text editor.

## Scan Every Installed Wabbajack List

This scans every child folder under `D:\Wabbajack\modlists` that contains both `mods` and `profiles`.

```powershell
python tools\bordello_armor_stat_scanner.py `
  --wabbajack-root "D:\Wabbajack\modlists" `
  --scan-installed `
  --output "data\installed-armor-stats.csv"
```

## Resolve Vanilla Materials And Keywords

The scanner automatically checks `<instance>\Stock Game\Data`. If that folder does not exist and you do not pass `--game-data`, mod-defined keywords are still resolved, but vanilla keywords such as `ArmorMaterialDaedric`, `ArmorLight`, `ArmorHeavy`, and `VendorItemArmor` may only appear as raw FormIDs.

```powershell
python tools\bordello_armor_stat_scanner.py `
  --mo2-instance "D:\Wabbajack\modlists\DoD" `
  --profile "Default" `
  --game-data "C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition\Data" `
  --output "data\dod-armor-stats.csv"
```

If Skyrim is installed somewhere else, point `--game-data` at that install's `Data` folder.

## Common Beginner Problems

### `python` Is Not Recognized

Try the Windows launcher:

```powershell
py -3 tools\bordello_armor_stat_scanner.py --help
```

If that also fails, install Python 3.10+ and enable `Add python.exe to PATH`.

### Profile Not Found

Open:

```text
<your modlist folder>\profiles
```

Copy the exact folder name and use it after `--profile`.

### No Plugins Found

Check that your `--mo2-instance` path points at the MO2 instance root, not at `mods`, `profiles`, or the Wabbajack download folder. The folder you pass should contain `mods` and `profiles`.

### The CSV Has Raw FormIDs Instead Of Material Names

Add `--game-data` and point it at Skyrim's `Data` folder, or use a Wabbajack list that has `<instance>\Stock Game\Data`.

### The Script Takes A While

Large adult Skyrim lists can have several thousand active plugins and tens of thousands of armor records. A full scan taking a minute or more is normal.

## Useful Filters

Only heavy armor:

```powershell
python tools\bordello_armor_stat_scanner.py --mo2-instance "D:\Wabbajack\modlists\DoD" --type heavy --output "data\dod-heavy-armor.csv"
```

Search by mod/plugin/name/editor ID/keyword:

```powershell
python tools\bordello_armor_stat_scanner.py --mo2-instance "D:\Wabbajack\modlists\DoD" --filter "daedric|bikini|steel" --output "data\dod-filtered-armor.csv"
```

Also write JSON:

```powershell
python tools\bordello_armor_stat_scanner.py --mo2-instance "D:\Wabbajack\modlists\DoD" --output "data\dod-armor-stats.csv" --json "data\dod-armor-stats.json"
```

## Reading The CSV

- `armor_category` is the scanner's best category: keyword category first, then the `BOD2/BODT` template type.
- `bod_template_type` is the type stored in the armor's body template.
- `keyword_category` is only populated when vanilla category keywords resolve.
- `material_keywords` comes from resolved keyword names, usually `ArmorMaterial*`.
- `full_name_source` says whether the name came directly from the plugin, a loose `.strings` file, or was missing from the string table.

Recommended columns to start with:

- `modlist_label`
- `mod_name`
- `plugin_file`
- `editor_id`
- `full_name`
- `armor_category`
- `material_keywords`
- `armor_rating`
- `value`
- `weight`
- `biped_slots`

## Limits

- This reads active plugins listed in `plugins.txt` and enabled mods listed in `modlist.txt`; it does not launch MO2.
- It does not read BSA-packed string tables. Loose `Strings/<plugin>_english.strings` files are supported.
- It is a raw plugin scanner. It does not calculate final xEdit conflict winners across every override with the same precision as a loaded xEdit session.
- Crafting/tempering recipes live in `COBJ` records and are not included yet.
- Mesh-only outfit packs with no plugin `ARMO` records will not appear.

For website publishing, keep using `data/armor-catalog.csv` as the curated public source. Treat this stat CSV as evidence for filling or auditing that catalog.
