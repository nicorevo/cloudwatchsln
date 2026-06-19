#!/usr/bin/env python3
"""Checks that AI-generated Java code has human-reviewed tags."""
import sys
from pathlib import Path
import re

AI_TAG = re.compile(r'//\s*ai-generated')
REVIEWED_TAG = re.compile(r'human-reviewed:\s*yes', re.IGNORECASE)

def check_file(path: Path) -> list[str]:
    errors = []
    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()

    for i, line in enumerate(lines, 1):
        if AI_TAG.search(line):
            # Check same line or next line for human-reviewed
            context = line + (lines[i] if i < len(lines) else "")
            if not REVIEWED_TAG.search(context):
                errors.append(f"{path}:{i}: ai-generated tag without 'human-reviewed: yes'")
    return errors

def main():
    java_files = list(Path("src").rglob("*.java")) if Path("src").exists() else []
    all_errors = []
    for f in java_files:
        all_errors.extend(check_file(f))

    if all_errors:
        for e in all_errors:
            print(f"❌ {e}")
        sys.exit(1)
    else:
        print(f"✅ Checked {len(java_files)} Java files — AI traceability OK")

if __name__ == "__main__":
    main()
