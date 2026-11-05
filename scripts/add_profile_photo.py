from __future__ import annotations

import json
import re
from pathlib import Path


HTML_PATH = Path("/Users/sihle/Documents/ChatGPT/DDISA/DDISA - Grantee Directory.html")


def main() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")
    match = re.search(r"const data=(\[.*?\]);\nlet region=", html, re.DOTALL)
    if not match:
        raise ValueError("Directory data could not be located")

    records = json.loads(match.group(1))
    for record in records:
        if record["name"] == "Digital Woman Uganda":
            record["photo"] = "assets/profiles/digital-woman-uganda-community.webp"
            record["photoAlt"] = "Digital Woman Uganda participants at a programme event."
            break
    else:
        raise ValueError("Digital Woman Uganda record not found")

    records_json = ",\n  ".join(
        json.dumps(record, ensure_ascii=False) for record in records
    )
    html = (
        html[: match.start(1)]
        + f"[\n  {records_json}\n]"
        + html[match.end(1) :]
    )
    HTML_PATH.write_text(html, encoding="utf-8")
    print("Added Digital Woman Uganda profile photo")


if __name__ == "__main__":
    main()
