#!/usr/bin/env python3
# debug_issue.py
import json

# Load the main script's extract_author function and test it
exec(open('extract_linkedin_emails.py').read())

# Test the exact same data
with open('dataset_linkedin-post-comments_2025-09-05_03-31-17-278.json', 'r') as f:
    items = json.load(f)

# Test first item specifically
first_item = items[0]
print("Testing first item:")
print(f"Item keys: {list(first_item.keys())}")
print(f"Actor field: {first_item.get('actor')}")

author_result = extract_author(first_item)
print(f"extract_author result: {author_result}")

# Test the main function call path
comment_text = pick_comment_text(first_item)
print(f"comment_text: '{comment_text}'")

source = source_from_item(first_item)
print(f"source: '{source}'")
