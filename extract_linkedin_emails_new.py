#!/usr/bin/env python3
# extract_linkedin_emails_new.py
import sys, json, csv, re, pathlib
from typing import Any, Dict, Iterable, List, Optional

# Stop at the TLD: no letters/dots/hyphens allowed immediately after it
EMAIL_RE = re.compile(
    r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?=$|[\s.,;:!?)}\]])",
    re.I,
)

def deobfuscate(s: str) -> str:
    """Convert common email obfuscations to proper format."""
    # Replace standalone at/dot tokens (optionally wrapped in () or [])
    s = re.sub(r"(?i)\b(?:\(|\[)?at(?:\)|\])?\b", "@", s)
    s = re.sub(r"(?i)\b(?:\(|\[)?dot(?:\)|\])?\b", ".", s)
    # Collapse whitespace around '@' only
    s = re.sub(r"\s*@\s*", "@", s)
    return s

def load_items(path: str) -> List[Dict[str, Any]]:
    txt = pathlib.Path(path).read_text(encoding="utf-8").strip()
    if not txt:
        return []
    if txt[0] == "{" and "\n" in txt:  # JSON Lines
        return [json.loads(line) for line in txt.splitlines() if line.strip()]
    return json.loads(txt)  # JSON array

def iter_strings(x: Any) -> Iterable[str]:
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from iter_strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from iter_strings(v)

def pick_comment_text(item: Dict[str, Any]) -> Optional[str]:
    """Extract the main comment text from the item."""
    # Check for the new 'commentary' field first
    commentary = item.get("commentary")
    if isinstance(commentary, str) and commentary.strip():
        return commentary
    
    # Fallback to other possible keys
    for k in ("comment","text","message","body","content","value","commentText"):
        v = item.get(k)
        if isinstance(v, str) and v.strip():
            return v
    
    return None

def extract_author(item: Dict[str, Any]) -> Dict[str, str]:
    """Extract author information from the item."""
    first = last = name = profile = ""
    
    # Check for new 'actor' field structure
    actor = item.get("actor")
    if isinstance(actor, dict):
        name = actor.get("name") or ""
        profile = actor.get("linkedinUrl") or ""
        
        # Extract first/last names from full name
        if name:
            parts = name.split()
            first = parts[0] if parts else ""
            last = " ".join(parts[1:]) if len(parts) > 1 else ""
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

def source_from_item(item: Dict[str, Any]) -> str:
    """Extract source URL from the item."""
    # Check for new 'linkedinUrl' field first
    linkedin_url = item.get("linkedinUrl")
    if isinstance(linkedin_url, str):
        return linkedin_url
    
    # Fallback to other possible URL fields
    for k in ("link","permalink","updateUrl","postUrl","url"):
        v = item.get(k)
        if isinstance(v, str):
            return v
    
    # If no direct URL, try to build from postId and profile
    pid = item.get("postId") or item.get("updateId") or item.get("activityId") or ""
    au = extract_author(item).get("profileUrl", "")
    return f"{au} {pid}".strip()

def load_existing_emails(path: str) -> set:
    """Load existing emails from EmailOctopus export CSV."""
    emails = set()
    p = pathlib.Path(path)
    if not p.exists():
        return emails
    content = p.read_text(encoding="utf-8")
    if content.startswith("\ufeff"):
        content = content[1:]
    reader = csv.DictReader(content.splitlines())
    for row in reader:
        for key in ("Email address","Email Address","email","Email"):
            if key in row and row[key]:
                emails.add(row[key].lower())
                break
    return emails

def main(in_path: str, out_path: str, existing_emails_path: Optional[str] = None):
    items = load_items(in_path)
    seen = set()
    if existing_emails_path:
        seen |= load_existing_emails(existing_emails_path)

    rows = []
    TRAILING_PUNCT = '.,;:!?)]}"\''

    for it in items:
        if not isinstance(it, dict):
            continue

        comment_text = pick_comment_text(it)
        author = extract_author(it)
        src = source_from_item(it)

        # Focus on comment text first
        if comment_text:
            s_clean = deobfuscate(comment_text)
            for m in EMAIL_RE.findall(s_clean):
                email = m.lower().rstrip(TRAILING_PUNCT)
                if email in seen:
                    continue
                seen.add(email)
                
                rows.append({
                    "Email Address": email,
                    "First Name": author["first"],
                    "Last Name": author["last"],
                    "Source": src,
                    "Note": comment_text[:240]
                })

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["Email Address","First Name","Last Name","Source","Note"]
        )
        w.writeheader()
        w.writerows(rows)

    print(f"Extracted {len(rows)} unique emails → {out_path}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_linkedin_emails_new.py <input_json_or_jsonl> <output_csv> [existing_emails_csv]")
        sys.exit(1)
    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) >= 3 else "emailoctopus_import.csv"
    existing = sys.argv[3] if len(sys.argv) >= 4 else None
    main(in_path, out_path, existing)
