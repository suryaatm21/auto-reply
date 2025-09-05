#!/usr/bin/env python3
# debug_extract.py
import sys, json, csv, re, pathlib
from typing import Any, Dict, Iterable, List, Optional

def extract_author_debug(item: Dict[str, Any]) -> Dict[str, str]:
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
    else:
        # Fallback to old 'author' field structure
        a = item.get("author")
        if isinstance(a, dict):
            name = a.get("name") or ""
            first = a.get("firstName") or ""
            last = a.get("lastName") or ""
            profile = a.get("profileUrl") or ""
        
        # If we still don't have first/last but have name, split it
        if (not first or not last) and name:
            parts = name.split()
            first = parts[0] if parts else ""
            last = " ".join(parts[1:]) if len(parts) > 1 else ""
    
    return {"first": first, "last": last, "profileUrl": profile}

# Test with first few records
with open('dataset_linkedin-post-comments_2025-09-05_03-31-17-278.json', 'r') as f:
    data = json.load(f)

print("Testing first 3 records:")
for i, item in enumerate(data[:3]):
    commentary = item.get("commentary", "")
    if "@" in commentary:  # Only check email-containing records
        author = extract_author_debug(item)
        print(f"Record {i}: Email='{commentary}', Author={author}")
