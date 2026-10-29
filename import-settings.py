#!/usr/bin/env python3
"""Baut aus den Live-Einstellungen eines Benutzers eine fertige Config-Datei
fuer einen anderen Benutzer - passend zum installierten Settings-Schema.

Aufruf:
    import-settings.py <quelle.json> <settings-schema.json> <ziel.json>

Es werden nur die Werte uebernommen; Layout, Beschreibungen und Spalten kommen
aus dem Schema, damit die Datei exakt dem entspricht, was Cinnamon selbst
schreiben wuerde (inklusive korrekter __md5__).
"""

import collections
import hashlib
import json
import os
import shutil
import sys


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)

    src, schema_path, dst = sys.argv[1:4]

    with open(schema_path, "rb") as handle:
        raw = handle.read()

    # Cinnamon prueft global.get_md5_for_string(templateString)
    md5 = hashlib.md5(raw).hexdigest()
    schema = json.loads(raw.decode("utf-8"), object_pairs_hook=collections.OrderedDict)

    with open(src, "r", encoding="utf-8") as handle:
        live = json.load(handle, object_pairs_hook=collections.OrderedDict)

    copied = 0
    for key, item in schema.items():
        if key == "__md5__" or not isinstance(item, dict) or "type" not in item:
            continue

        if key in live and isinstance(live[key], dict) and "value" in live[key]:
            item["value"] = live[key]["value"]
            copied += 1
        else:
            item["value"] = item.get("default")

    schema["__md5__"] = md5

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    if os.path.exists(dst):
        shutil.copy2(dst, dst + ".bak")

    with open(dst, "w", encoding="utf-8") as handle:
        json.dump(schema, handle, indent=4, ensure_ascii=False)

    print("Einstellungen uebernommen: %d Werte, Schema-MD5 %s" % (copied, md5))


if __name__ == "__main__":
    main()
