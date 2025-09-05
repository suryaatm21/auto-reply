#!/usr/bin/env python3
# debug_main.py - simplified version of main script with debug output
import sys, json, csv, re, pathlib
from typing import Any, Dict, Iterable, List, Optional

EMAIL_RE = re.compile(
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?=$|[\s.,;:!?)}\]])",
    re.I,
)

def extract_author(item: Dict[str, Any]) -> Dict[str, str]:
    first = last = name = profile = ""
    
    # Check for new 'actor' field structure
    actor = item.get("actor")
    if isinstance(actor, dict):
        name = actor.get("name") or ""
        profile = actor.get("linkedinUrl") or ""
        # Extract first/last names from full name if not directly available
        if name and not (actor.get("firstName") and actor.get("lastName")):
            parts = name.split()
            first = parts[0] if parts else ""
            last = " ".join(parts[1:]) if len(parts) > 1 else ""
        else:
            first = actor.get("firstName") or ""
            last = actor.get("lastName") or ""
    
    return {"first": first, "last": last, "profileUrl": profile}

# Load JSON data
with open('dataset_linkedin-post-comments_2025-09-05_03-31-17-278.json', 'r') as f:
    items = json.load(f)

rows = []
for i, item in enumerate(items[:3]):  # Only process first 3 items
    commentary = item.get("commentary", "")
    print(f"\nProcessing item {i}: commentary='{commentary}'")
    
    if "@" in commentary:
        author = extract_author(item)
        print(f"Author info: {author}")
        
        # Extract email
        for m in EMAIL_RE.findall(commentary):
            email = m.lower()
            print(f"Found email: {email}")
            
            rows.append({
                "Email Address": email,
                "First Name": author["first"],
                "Last Name": author["last"],
                "Source": item.get("linkedinUrl", ""),
                "Note": commentary[:240]
            })
            print(f"Added row: {rows[-1]}")

print(f"\nFinal rows: {rows}")

# Write to CSV
with open("debug_output.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(
        f,
        fieldnames=["Email Address", "First Name", "Last Name", "Source", "Note"]
    )
    w.writeheader()
    w.writerows(rows)

print(f"Wrote {len(rows)} rows to debug_output.csv")
