#!/usr/bin/env python3
import json

# Read the first record and print debug info
with open('dataset_linkedin-post-comments_2025-09-05_03-31-17-278.json', 'r') as f:
    data = json.load(f)

first_item = data[0]
print("First item structure:")
print(json.dumps(first_item, indent=2))

# Test the extract_author function
def extract_author_debug(item):
    first = last = name = profile = ""
    
    print(f"\nDebugging extract_author for item: {item.get('id', 'unknown')}")
    
    # Check for new 'actor' field structure
    actor = item.get("actor")
    print(f"Actor field: {actor}")
    
    if isinstance(actor, dict):
        name = actor.get("name") or ""
        profile = actor.get("linkedinUrl") or ""
        print(f"Actor name: '{name}', profile: '{profile}'")
        
        # Extract first/last names from full name if not directly available
        if name and not (actor.get("firstName") and actor.get("lastName")):
            parts = name.split()
            first = parts[0] if parts else ""
            last = " ".join(parts[1:]) if len(parts) > 1 else ""
            print(f"Split name - first: '{first}', last: '{last}'")
        else:
            first = actor.get("firstName") or ""
            last = actor.get("lastName") or ""
            print(f"Direct from actor - first: '{first}', last: '{last}'")
    
    return {"first": first, "last": last, "profileUrl": profile}

result = extract_author_debug(first_item)
print(f"\nResult: {result}")
