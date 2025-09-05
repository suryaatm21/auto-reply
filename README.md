# LinkedIn Auto Reply + Backfill Scripts

⚠️ **Disclaimer:**  
These scripts automate interactions on LinkedIn and may violate LinkedIn’s Terms of Service. Use them at your own risk, preferably for testing/learning purposes only. To reduce detection risk, we’ve added random delays, per-session caps, and human-like typing.

---

## How It Works: Local Storage as a Hashmap

At the core, both scripts use your browser’s **`localStorage`** as a simple hashmap to track progress:

- **Keys**  
  Each LinkedIn post gets its own unique key, based on the post’s URN:

- **Values**  
  The value is a JSON object with a `processed` array that stores comment identifiers (comment URNs):

```json
{
  "processed": [
    "urn:li:comment:(activity:<post-id>,<comment-id-1>)",
    "urn:li:comment:(activity:<post-id>,<comment-id-2>)"
  ]
}

- **Behavior**




## Overview

We built two cooperating scripts:

1. **`backfill.js`** – scans an existing LinkedIn post’s comments and marks all the ones you have already replied to. This ensures you don’t re-reply when running the auto-replyer.
2. **`auto_reply.js`** – actively replies to comments that match our criteria (emails earlier, now keyword `"systems"`) with one of our configured message templates. It also likes each comment as a visible marker.

Both scripts store progress in **`localStorage`**, under a key unique to the LinkedIn post’s URN (e.g.
`li-auto-reply.progress:urn:li:activity:7359689886720757761`).
This makes progress **persistent across sessions** – you can stop and resume anytime.

---

## `backfill.js`

### Purpose
- Crawl through all comments on a post.
- Identify comments you’ve **already replied to**:
  - By checking if any nested reply was authored by your profile slug (`/in/surya-atmuri`).
  - Or by checking if a nested reply contains one of your known template phrases.
- Persist those comment URNs to `localStorage`.

### Features
- **Autoscrolls** and clicks “Load more” buttons repeatedly until no new comments are found.
- **Incremental saving** every N additions (so you don’t lose progress mid-run).
- **Controls**:
  - `liBackfill.pause()` / press **P** → pause/resume
  - `liBackfill.stop()` / press **S** → stop
  - `liBackfill.stats()` → report how many comments have been marked

---

## `auto_reply.js`

### Purpose
- Automatically reply to comments containing the keyword `"systems"` (case-insensitive).
- Append a **random message template** so replies look varied.
- **Like** each comment we reply to.

### Reply Flow
For each eligible comment:
1. Scroll to it.
2. Click the **Reply** button.
3. Focus the **editor** and append the message (preserving the @mention).
4. Wait until the editor state + submit button are ready.
5. Submit the reply (or press Enter if fallback needed).
6. Optionally click **Like**.
7. Save the comment URN to `localStorage`.

### Safety Features
- **Randomized delays** between actions, between replies, and while typing each character.
- **Session caps** (`maxRepliesPerRun`).
- **Skip logic**:
  - Skips if already processed in storage.
  - Skips if you’ve already replied manually.
  - Skips if `skipIfLiked` is true and you’ve already liked it.
- **Manual controls**:
  - `liReply.start()` → begin run
  - `liReply.pause()` / press **P** → pause/resume
  - `liReply.stop()` / press **S** → stop gracefully
  - `liReply.setMax(n)` → adjust max replies per run
  - `liReply.setKeywords([...])` → change keyword filter
  - `liReply.stats()` → print run stats

---

## Delay Profiles

We tested two styles:

- **Fast Testing (5 replies/run)**
  Short delays (hundreds of ms) to quickly debug logic.
- **Production Safe**
  Longer, randomized delays to mimic a rushed human:
  - Actions: 1.2–2.2s
  - Typing: 25–55ms per char
  - Between replies: 8–18s
  - Occasional backoff: 60–120s after ~15 replies

---

## Storage Keys

- Keys are always prefixed:
```
