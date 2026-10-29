#!/usr/bin/env python3
"""Build a settings file for another user from the live settings of the caller.

Usage:
    import-settings.py <source.json> <settings-schema.json> <target.json>

Only the values are copied; layout, descriptions and columns come from the
schema, so the result is exactly what Cinnamon itself would write (including a
correct __md5__).
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

    source, schema_path, target = sys.argv[1:4]

    with open(schema_path, "rb") as handle:
        raw = handle.read()

    # Cinnamon compares global.get_md5_for_string(templateString)
    md5 = hashlib.md5(raw).hexdigest()
    schema = json.loads(raw.decode("utf-8"), object_pairs_hook=collections.OrderedDict)

    with open(source, "r", encoding="utf-8") as handle:
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

    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    if os.path.exists(target):
        shutil.copy2(target, target + ".bak")

    with open(target, "w", encoding="utf-8") as handle:
        json.dump(schema, handle, indent=4, ensure_ascii=False)

    print("Copied %d values, schema MD5 %s" % (copied, md5))


if __name__ == "__main__":
    main()
