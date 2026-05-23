"""
bordello_armor_stat_scanner.py
------------------------------
Export raw ARMO records from one or more Mod Organizer 2 / Wabbajack
instances to CSV.

The scanner is dependency-free and reads plugin files directly. It is intended
for audit/catalog work, not for replacing xEdit when you need exact conflict
resolution.

Examples:
    python tools/bordello_armor_stat_scanner.py --mo2-instance "D:\\Wabbajack\\modlists\\DoD" --profile Default --output data\\dod-armor-stats.csv
    python tools/bordello_armor_stat_scanner.py --wabbajack-root "D:\\Wabbajack\\modlists" --scan-installed --output data\\installed-armor-stats.csv
    python tools/bordello_armor_stat_scanner.py --mo2-instance "D:\\Wabbajack\\modlists\\DoD" --game-data "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Skyrim Special Edition\\Data"
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import struct
import sys
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Iterator


REC_HEADER_SIZE = 24
GRUP_HEADER_SIZE = 24
SUB_HEADER_SIZE = 6
FLAG_COMPRESSED = 0x00040000

DEFAULT_WABBAJACK_ROOT = Path(r"D:\Wabbajack\modlists")

BIPED_SLOTS: dict[int, str] = {
    30: "Head",
    31: "Hair",
    32: "Body",
    33: "Hands",
    34: "Forearms",
    35: "Amulet",
    36: "Ring",
    37: "Feet",
    38: "Calves",
    39: "Shield",
    40: "Tail",
    41: "Long Hair",
    42: "Circlet",
    43: "Ears",
    50: "DecapitateHead",
    51: "Decapitate",
    **{i: f"Custom Slot ({i})" for i in range(44, 50)},
    **{i: f"Custom Slot ({i})" for i in range(52, 62)},
}

ARMOR_TYPES: dict[int, str] = {
    0: "Light",
    1: "Heavy",
    2: "Clothing",
}

VANILLA_CATEGORY_KEYWORDS = {
    "ArmorLight": "Light",
    "ArmorHeavy": "Heavy",
    "ArmorClothing": "Clothing",
}

CSV_COLUMNS = [
    "modlist_label",
    "mo2_instance",
    "profile",
    "mod_name",
    "mod_priority",
    "plugin_file",
    "plugin_path",
    "form_id",
    "editor_id",
    "full_name",
    "full_name_source",
    "armor_category",
    "bod_template_type",
    "keyword_category",
    "armor_rating",
    "value",
    "weight",
    "biped_slots",
    "biped_slot_numbers",
    "keyword_edids",
    "keyword_form_ids",
    "material_keywords",
    "armor_slot_keywords",
    "vendor_keywords",
    "enchantment_form_id",
    "template_form_id",
    "male_world_model",
    "female_world_model",
]


@dataclass(frozen=True)
class Record:
    signature: str
    form_id: int
    flags: int
    body: bytes


@dataclass(frozen=True)
class PluginSource:
    mod_name: str
    mod_priority: int
    path: Path
    instance: Path
    profile: Path


@dataclass
class PluginContext:
    path: Path
    file_name: str
    file_table: list[str]
    strings: dict[int, str] = field(default_factory=dict)


@dataclass
class ArmorEntry:
    modlist_label: str
    mo2_instance: str
    profile: str
    mod_name: str
    mod_priority: int
    plugin_file: str
    plugin_path: str
    form_id: str
    editor_id: str
    full_name: str
    full_name_source: str
    armor_category: str
    bod_template_type: str
    keyword_category: str
    armor_rating: float
    value: int
    weight: float
    biped_slots: str
    biped_slot_numbers: str
    keyword_edids: str
    keyword_form_ids: str
    material_keywords: str
    armor_slot_keywords: str
    vendor_keywords: str
    enchantment_form_id: str
    template_form_id: str
    male_world_model: str
    female_world_model: str


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export Skyrim ARMO stats from MO2/Wabbajack instances to CSV."
    )
    parser.add_argument(
        "--mo2-instance",
        action="append",
        default=[],
        help="MO2/Wabbajack instance root containing mods/ and profiles/. Repeat for multiple lists.",
    )
    parser.add_argument(
        "--wabbajack-root",
        type=Path,
        default=DEFAULT_WABBAJACK_ROOT,
        help=f"Parent folder used by --scan-installed. Default: {DEFAULT_WABBAJACK_ROOT}",
    )
    parser.add_argument(
        "--scan-installed",
        action="store_true",
        help="Scan every child of --wabbajack-root that has mods/ and profiles/.",
    )
    parser.add_argument(
        "--profile",
        help="MO2 profile name. If omitted, the first profile is used per instance.",
    )
    parser.add_argument(
        "--game-data",
        type=Path,
        help="Optional Skyrim Data folder. Supplying this improves vanilla keyword/material resolution.",
    )
    parser.add_argument(
        "--language",
        default="english",
        help="String-table language suffix to read, e.g. english. Default: english.",
    )
    parser.add_argument("--output", type=Path, default=Path("armor-stats.csv"))
    parser.add_argument("--json", type=Path, help="Optional JSON output path.")
    parser.add_argument("--filter", help="Regex filter on editor ID, display name, mod, or plugin.")
    parser.add_argument(
        "--type",
        choices=["light", "heavy", "clothing", "mixed", "unknown"],
        help="Filter by resolved armor category.",
    )
    args = parser.parse_args()

    instances = [Path(value) for value in args.mo2_instance]
    if args.scan_installed:
        instances.extend(discover_instances(args.wabbajack_root))
    instances = dedupe_paths(instances)

    if not instances:
        parser.error("Pass --mo2-instance, or use --scan-installed with --wabbajack-root.")

    all_entries: list[ArmorEntry] = []
    for instance in instances:
        all_entries.extend(scan_instance(instance, args.profile, args.game_data, args.language))

    filtered = apply_filters(all_entries, args.filter, args.type)
    write_csv(args.output, filtered)
    if args.json:
        write_json(args.json, filtered)

    print(f"Scanned {len(instances)} instance(s).")
    print(f"Exported {len(filtered)} armor row(s) to {args.output.resolve()}.")
    if len(filtered) != len(all_entries):
        print(f"Filtered from {len(all_entries)} total armor row(s).")


def discover_instances(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return [
        child
        for child in sorted(root.iterdir(), key=lambda p: p.name.casefold())
        if child.is_dir() and (child / "mods").exists() and (child / "profiles").exists()
    ]


def dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path.resolve()).casefold() if path.exists() else str(path).casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(path)
    return result


def scan_instance(instance: Path, profile_name: str | None, game_data: Path | None, language: str) -> list[ArmorEntry]:
    instance = instance.resolve()
    mods_dir = instance / "mods"
    profiles_dir = instance / "profiles"
    if not mods_dir.exists() or not profiles_dir.exists():
        print(f"[WARN] Skipping {instance}: expected mods/ and profiles/.")
        return []

    profile = select_profile(profiles_dir, profile_name)
    enabled_mods = read_enabled_mods(profile / "modlist.txt")
    active_plugins = read_active_plugins(profile / "plugins.txt")
    plugin_sources = collect_plugin_sources(instance, profile, mods_dir, enabled_mods, active_plugins)

    if not plugin_sources:
        print(f"[WARN] No active mod plugins found for {instance.name} / {profile.name}.")
        return []

    print(f"{instance.name}: profile {profile.name}, {len(enabled_mods)} enabled mods, {len(plugin_sources)} plugins")

    resolved_game_data = game_data or detect_stock_game_data(instance)
    base_plugins = collect_game_data_plugins(resolved_game_data)
    contexts = build_contexts([*base_plugins, *plugin_sources], language)
    keyword_map = build_keyword_map(contexts.values())

    entries: list[ArmorEntry] = []
    for index, source in enumerate(plugin_sources, start=1):
        if index % 50 == 0:
            print(f"  {instance.name}: scanned {index}/{len(plugin_sources)} plugins...")
        context = contexts.get(source.path.resolve())
        if not context:
            context = build_plugin_context(source.path, language)
        entries.extend(parse_plugin_armors(source, context, keyword_map))
    return entries


def select_profile(profiles_dir: Path, preferred: str | None) -> Path:
    if preferred:
        match = profiles_dir / preferred
        if match.exists():
            return match
        raise SystemExit(f"[ERROR] Profile '{preferred}' not found under {profiles_dir}.")
    profiles = [path for path in sorted(profiles_dir.iterdir(), key=lambda p: p.name.casefold()) if path.is_dir()]
    if not profiles:
        raise SystemExit(f"[ERROR] No profiles found under {profiles_dir}.")
    return profiles[0]


def read_enabled_mods(modlist_path: Path) -> list[str]:
    if not modlist_path.exists():
        raise SystemExit(f"[ERROR] Missing modlist.txt: {modlist_path}")
    enabled: list[str] = []
    with modlist_path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if line.startswith("+") and not line.startswith("++"):
                enabled.append(line[1:])
    return enabled


def read_active_plugins(plugins_path: Path) -> set[str]:
    if not plugins_path.exists():
        return set()
    active: set[str] = set()
    with plugins_path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("*"):
                active.add(line[1:].casefold())
            elif not line.startswith("-"):
                active.add(line.lstrip("+").casefold())
    return active


def collect_plugin_sources(
    instance: Path,
    profile: Path,
    mods_dir: Path,
    enabled_mods: list[str],
    active_plugins: set[str],
) -> list[PluginSource]:
    mod_dirs = {path.name.casefold(): path for path in mods_dir.iterdir() if path.is_dir()}
    sources: list[PluginSource] = []
    for priority, mod_name in enumerate(enabled_mods):
        mod_dir = mod_dirs.get(mod_name.casefold())
        if not mod_dir:
            continue
        for pattern in ("*.esm", "*.esl", "*.esp"):
            for plugin in sorted(mod_dir.rglob(pattern), key=lambda p: str(p).casefold()):
                if not plugin.is_file():
                    continue
                if active_plugins and plugin.name.casefold() not in active_plugins:
                    continue
                sources.append(
                    PluginSource(
                        mod_name=mod_name,
                        mod_priority=priority,
                        path=plugin.resolve(),
                        instance=instance,
                        profile=profile,
                    )
                )
    return sources


def collect_game_data_plugins(game_data: Path | None) -> list[PluginSource]:
    if not game_data or not game_data.exists():
        return []
    sources: list[PluginSource] = []
    for name in ("Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"):
        plugin = game_data / name
        if plugin.exists():
            sources.append(
                PluginSource(
                    mod_name="[Game Data]",
                    mod_priority=-1,
                    path=plugin.resolve(),
                    instance=game_data.resolve(),
                    profile=game_data.resolve(),
                )
            )
    return sources


def detect_stock_game_data(instance: Path) -> Path | None:
    candidate = instance / "Stock Game" / "Data"
    return candidate if candidate.exists() else None


def build_contexts(sources: list[PluginSource], language: str) -> dict[Path, PluginContext]:
    contexts: dict[Path, PluginContext] = {}
    for source in sources:
        try:
            contexts[source.path.resolve()] = build_plugin_context(source.path, language)
        except OSError as error:
            print(f"[WARN] Cannot read {source.path}: {error}")
    return contexts


def build_plugin_context(plugin_path: Path, language: str) -> PluginContext:
    masters = read_plugin_masters(plugin_path)
    file_name = plugin_path.name
    file_table = [normalize_plugin_name(name) for name in masters]
    if normalize_plugin_name(file_name) not in file_table:
        file_table.append(normalize_plugin_name(file_name))
    return PluginContext(
        path=plugin_path,
        file_name=normalize_plugin_name(file_name),
        file_table=file_table,
        strings=load_string_table(plugin_path, language),
    )


def read_plugin_masters(plugin_path: Path) -> list[str]:
    try:
        for record in iter_records(plugin_path, signatures={"TES4"}):
            subs = read_subrecords(record.body)
            return [
                value.decode("utf-8", errors="replace").rstrip("\x00")
                for value in subs.get("MAST", [])
                if value
            ]
    except OSError:
        return []
    return []


def build_keyword_map(contexts: Iterable[PluginContext]) -> dict[str, str]:
    keywords: dict[str, str] = {}
    for context in contexts:
        try:
            records = iter_records(context.path, signatures={"KYWD"})
            for record in records:
                subs = read_subrecords(record.body)
                editor_id = read_text_subrecord(subs, "EDID")
                if not editor_id:
                    continue
                keywords[resolve_form_key(context, record.form_id)] = editor_id
        except OSError as error:
            print(f"[WARN] Cannot scan keywords from {context.path}: {error}")
    return keywords


def parse_plugin_armors(
    source: PluginSource,
    context: PluginContext,
    keyword_map: dict[str, str],
) -> list[ArmorEntry]:
    entries: list[ArmorEntry] = []
    try:
        records = iter_records(source.path, signatures={"ARMO"})
        for record in records:
            entries.extend(parse_armor_record(source, context, keyword_map, record))
    except OSError as error:
        print(f"[WARN] Cannot scan armors from {source.path}: {error}")
    return entries


def parse_armor_record(
    source: PluginSource,
    context: PluginContext,
    keyword_map: dict[str, str],
    record: Record,
) -> list[ArmorEntry]:
    entries: list[ArmorEntry] = []
    try:
        subs = read_subrecords(record.body)
        editor_id = read_text_subrecord(subs, "EDID")
        full_name, full_name_source = read_full_name(subs, context)
        if not editor_id and not full_name:
            return []

        biped_flags, bod_type_int = read_body_template(subs)
        slot_numbers, slot_names = decode_biped_flags(biped_flags)
        armor_rating = read_float_subrecord(subs, "DNAM")
        value, weight = read_value_weight(subs)

        keyword_form_ids = read_form_ids(subs, "KWDA")
        keyword_keys = [resolve_form_key(context, form_id) for form_id in keyword_form_ids]
        keyword_edids = [keyword_map[key] for key in keyword_keys if key in keyword_map]
        keyword_category = infer_keyword_category(keyword_edids)
        bod_template_type = ARMOR_TYPES.get(bod_type_int, f"Unknown ({bod_type_int})")
        armor_category = keyword_category or bod_template_type or "Unknown"

        material_keywords = [
            keyword for keyword in keyword_edids
            if re.search(r"(^ArmorMaterial|Material)", keyword, re.IGNORECASE)
        ]
        armor_slot_keywords = [
            keyword for keyword in keyword_edids
            if re.search(r"^(Armor|Clothing)(Cuirass|Helmet|Boots|Gauntlets|Shield|Body|Head|Hands|Feet|Ring|Necklace|Circlet)", keyword)
        ]
        vendor_keywords = [
            keyword for keyword in keyword_edids
            if keyword.startswith("VendorItem")
        ]

        entries.append(
            ArmorEntry(
                modlist_label=source.instance.name,
                mo2_instance=str(source.instance),
                profile=source.profile.name,
                mod_name=source.mod_name,
                mod_priority=source.mod_priority,
                plugin_file=source.path.name,
                plugin_path=str(source.path),
                form_id=hex_form(record.form_id),
                editor_id=editor_id,
                full_name=full_name,
                full_name_source=full_name_source,
                armor_category=armor_category,
                bod_template_type=bod_template_type,
                keyword_category=keyword_category,
                armor_rating=round(armor_rating, 3),
                value=value,
                weight=round(weight, 3),
                biped_slots="; ".join(slot_names),
                biped_slot_numbers="; ".join(str(number) for number in slot_numbers),
                keyword_edids="; ".join(keyword_edids),
                keyword_form_ids="; ".join(hex_form(value) for value in keyword_form_ids),
                material_keywords="; ".join(material_keywords),
                armor_slot_keywords="; ".join(armor_slot_keywords),
                vendor_keywords="; ".join(vendor_keywords),
                enchantment_form_id=read_first_form_id(subs, "EITM"),
                template_form_id=read_first_form_id(subs, "TNAM"),
                male_world_model=read_text_subrecord(subs, "MOD2") or read_text_subrecord(subs, "MODL"),
                female_world_model=read_text_subrecord(subs, "MOD4"),
            )
        )
    except (struct.error, UnicodeDecodeError):
        return []
    return entries


def iter_records(path: Path, signatures: set[str] | None = None) -> Iterator[Record]:
    data = path.read_bytes()
    pos = 0
    length = len(data)
    while pos + 4 <= length:
        signature = data[pos:pos + 4].decode("latin-1", errors="replace")
        if signature == "GRUP":
            if pos + GRUP_HEADER_SIZE > length:
                break
            group_size = struct.unpack_from("<I", data, pos + 4)[0]
            if group_size < GRUP_HEADER_SIZE:
                break
            pos += GRUP_HEADER_SIZE
            continue

        if pos + REC_HEADER_SIZE > length:
            break
        data_size = struct.unpack_from("<I", data, pos + 4)[0]
        flags = struct.unpack_from("<I", data, pos + 8)[0]
        form_id = struct.unpack_from("<I", data, pos + 12)[0]
        body_start = pos + REC_HEADER_SIZE
        body_end = body_start + data_size
        if body_end > length:
            break

        if signatures is None or signature in signatures:
            body = data[body_start:body_end]
            if flags & FLAG_COMPRESSED and len(body) >= 4:
                try:
                    body = zlib.decompress(body[4:])
                except zlib.error:
                    pos = body_end
                    continue
            yield Record(signature=signature, form_id=form_id, flags=flags, body=body)
        pos = body_end


def read_subrecords(data: bytes) -> dict[str, list[bytes]]:
    subs: dict[str, list[bytes]] = {}
    pos = 0
    while pos + SUB_HEADER_SIZE <= len(data):
        sub_type = data[pos:pos + 4].decode("latin-1", errors="replace")
        sub_size = struct.unpack_from("<H", data, pos + 4)[0]
        pos += SUB_HEADER_SIZE
        sub_data = data[pos:pos + sub_size]
        pos += sub_size

        if sub_type == "XXXX" and len(sub_data) == 4 and pos + SUB_HEADER_SIZE <= len(data):
            real_type = data[pos:pos + 4].decode("latin-1", errors="replace")
            real_size = struct.unpack_from("<I", sub_data, 0)[0]
            pos += SUB_HEADER_SIZE
            subs.setdefault(real_type, []).append(data[pos:pos + real_size])
            pos += real_size
            continue

        subs.setdefault(sub_type, []).append(sub_data)
    return subs


def read_text_subrecord(subs: dict[str, list[bytes]], key: str) -> str:
    values = subs.get(key)
    if not values:
        return ""
    return decode_cstring(values[0])


def read_full_name(subs: dict[str, list[bytes]], context: PluginContext) -> tuple[str, str]:
    values = subs.get("FULL")
    if not values:
        return "", ""
    raw = values[0]
    if len(raw) == 4:
        string_id = struct.unpack_from("<I", raw, 0)[0]
        if string_id in context.strings:
            return context.strings[string_id], f"strings:{string_id}"
        return "", f"missing-string:{string_id}"
    return decode_cstring(raw), "plugin"


def read_body_template(subs: dict[str, list[bytes]]) -> tuple[int, int]:
    for key in ("BOD2", "BODT"):
        values = subs.get(key)
        if not values or len(values[0]) < 4:
            continue
        raw = values[0]
        flags = struct.unpack_from("<I", raw, 0)[0]
        armor_type = struct.unpack_from("<I", raw, 4)[0] if len(raw) >= 8 else 2
        return flags, armor_type
    return 0, 2


def read_float_subrecord(subs: dict[str, list[bytes]], key: str) -> float:
    values = subs.get(key)
    if not values or len(values[0]) < 4:
        return 0.0
    return struct.unpack_from("<f", values[0], 0)[0]


def read_value_weight(subs: dict[str, list[bytes]]) -> tuple[int, float]:
    values = subs.get("DATA")
    if not values or len(values[0]) < 8:
        return 0, 0.0
    return struct.unpack_from("<I", values[0], 0)[0], struct.unpack_from("<f", values[0], 4)[0]


def read_form_ids(subs: dict[str, list[bytes]], key: str) -> list[int]:
    form_ids: list[int] = []
    for raw in subs.get(key, []):
        for offset in range(0, len(raw) - 3, 4):
            form_ids.append(struct.unpack_from("<I", raw, offset)[0])
    return form_ids


def read_first_form_id(subs: dict[str, list[bytes]], key: str) -> str:
    values = subs.get(key)
    if not values or len(values[0]) < 4:
        return ""
    return hex_form(struct.unpack_from("<I", values[0], 0)[0])


def decode_biped_flags(flags: int) -> tuple[list[int], list[str]]:
    numbers: list[int] = []
    names: list[str] = []
    for slot, name in BIPED_SLOTS.items():
        if flags & (1 << (slot - 30)):
            numbers.append(slot)
            names.append(name)
    return numbers, names


def infer_keyword_category(keyword_edids: list[str]) -> str:
    categories = {
        VANILLA_CATEGORY_KEYWORDS[keyword]
        for keyword in keyword_edids
        if keyword in VANILLA_CATEGORY_KEYWORDS
    }
    if len(categories) > 1:
        return "Mixed"
    if categories:
        return next(iter(categories))
    return ""


def resolve_form_key(context: PluginContext, form_id: int) -> str:
    file_index = (form_id >> 24) & 0xFF
    local_id = form_id & 0x00FFFFFF
    if file_index < len(context.file_table):
        return f"{context.file_table[file_index]}:{local_id:06X}"
    return f"{context.file_name}:{local_id:06X}"


def normalize_plugin_name(name: str) -> str:
    return Path(name).name.casefold()


def hex_form(value: int) -> str:
    return f"0x{value:08X}"


def decode_cstring(raw: bytes) -> str:
    text = raw.split(b"\x00", 1)[0]
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return text.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return text.decode("latin-1", errors="replace").strip()


def load_string_table(plugin_path: Path, language: str) -> dict[int, str]:
    strings_dir = plugin_path.parent / "Strings"
    if not strings_dir.exists():
        return {}
    table_path = strings_dir / f"{plugin_path.stem}_{language}.strings"
    if not table_path.exists():
        return {}
    try:
        return parse_strings_file(table_path)
    except (OSError, struct.error) as error:
        print(f"[WARN] Cannot read strings table {table_path}: {error}")
        return {}


def parse_strings_file(path: Path) -> dict[int, str]:
    data = path.read_bytes()
    if len(data) < 8:
        return {}
    count, _data_size = struct.unpack_from("<II", data, 0)
    directory_start = 8
    data_start = directory_start + count * 8
    strings: dict[int, str] = {}
    for index in range(count):
        entry_offset = directory_start + index * 8
        string_id, offset = struct.unpack_from("<II", data, entry_offset)
        start = data_start + offset
        end = data.find(b"\x00", start)
        if end == -1:
            end = len(data)
        strings[string_id] = decode_cstring(data[start:end])
    return strings


def apply_filters(entries: list[ArmorEntry], pattern: str | None, armor_type: str | None) -> list[ArmorEntry]:
    filtered = entries
    if pattern:
        regex = re.compile(pattern, re.IGNORECASE)
        filtered = [
            entry for entry in filtered
            if regex.search(" ".join([
                entry.editor_id,
                entry.full_name,
                entry.mod_name,
                entry.plugin_file,
                entry.keyword_edids,
            ]))
        ]
    if armor_type:
        expected = armor_type.capitalize()
        filtered = [
            entry for entry in filtered
            if entry.armor_category.casefold() == expected.casefold()
        ]
    return filtered


def write_csv(path: Path, entries: list[ArmorEntry]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for entry in entries:
            writer.writerow(asdict(entry))


def write_json(path: Path, entries: list[ArmorEntry]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump([asdict(entry) for entry in entries], handle, indent=2, ensure_ascii=False)
        handle.write("\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130)
