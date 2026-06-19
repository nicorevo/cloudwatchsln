#!/usr/bin/env python3
"""Validates YAML frontmatter in Markdown files."""
import sys
import re
from pathlib import Path
import yaml

REQUIRED_FIELDS_BY_DIR = {
    "docs/agent-skills": ["name", "description"],
    ".cursor/skills": ["name", "description"],
    "docs": ["title"],
}

def extract_frontmatter(content: str):
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None
    try:
        return yaml.safe_load(match.group(1))
    except yaml.YAMLError:
        return None

def check_file(path: Path) -> list[str]:
    errors = []
    content = path.read_text(encoding="utf-8")
    fm = extract_frontmatter(content)

    for dir_prefix, required in REQUIRED_FIELDS_BY_DIR.items():
        if str(path).startswith(dir_prefix):
            if fm is None:
                errors.append(f"{path}: missing frontmatter")
                return errors
            for field in required:
                if field not in fm:
                    errors.append(f"{path}: missing required field '{field}'")
    return errors

def main():
    md_files = list(Path(".").rglob("*.md"))
    all_errors = []
    for f in md_files:
        if ".git" in str(f):
            continue
        all_errors.extend(check_file(f))

    if all_errors:
        for e in all_errors:
            print(f"❌ {e}")
        sys.exit(1)
    else:
        print(f"✅ Validated {len(md_files)} markdown files — all good")

if __name__ == "__main__":
    main()
