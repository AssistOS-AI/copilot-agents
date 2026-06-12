---
name: create-akus
description: Create an Agentic Knowledge Units (.aku) directory structure from WAC JSON embedded in the prompt. Reads WAC JSON data, creates the .aku root in the current project directory, then creates individual KU directories under .aku/kus/ with manifest.json and state.md files for each knowledge unit (site, profiles, contact).
---

# Create AKUs

## Overview

Use this skill when you need to build an AKU (Agentic Knowledge Units) structure from WAC (WebAssist Context) data embedded in the user's prompt. The WAC JSON contains four fields: `siteInfo` (text), `profilesInfo` (object mapping profile IDs to descriptions), `contactInfo` (text), and `siteMap` (array of URLs).

You create the `.aku/` directory tree directly via filesystem operations. You do not use achillesAgentLib. You do not build search indexes — those are rebuilt by achillesAgentLib when loadAKU is called.

## Directives

1. Treat the current working directory as the site project root.
2. Create the `.aku/` root directory at `<current working directory>/.aku`.
3. Create `.aku/aku.json` with schema version, name (siteId), actor, and createdAt timestamp.
4. Create `.aku/kus/` directory to hold all knowledge unit folders.
5. Create one KU folder per knowledge unit: site, one per profile, and contact.
6. Each KU folder contains `manifest.json` and `state.md`.
7. Do not create search index files, lock files, or pending directories.
8. Report a plain text summary of all KUs created, or an error message if any step fails.

## Workflow

### 1. Parse Input

The user prompt provides two values:
- `WAC JSON` — the full WAC JSON object with `siteInfo`, `profilesInfo`, `contactInfo`, `siteMap`
- `siteId` — the derived site identifier string

Validate that both values are present and non-empty. If either is missing, report an error and stop.

Set `akuDir` to `.aku` under the current working directory. Do not require or ask for an explicit `akuDir` value.

### 2. Create .aku Root

Create the `.aku` directory with `recursive: true`.

Write `.aku/aku.json`:
```json
{
  "schemaVersion": 1,
  "name": "<siteId>",
  "actor": "webassist/<siteId>",
  "createdAt": "<current ISO 8601 timestamp>"
}
```

### 3. Create .aku/kus/ Directory

Create `.aku/kus/` with `recursive: true`.

### 4. Create Site KU

Create directory `.aku/kus/ku_site/`.

Write `.aku/kus/ku_site/manifest.json`:
```json
{
  "ku_id": "ku_site",
  "ku_name": "Site Context",
  "ku_type": "site",
  "keywords": ["site", "identity", "services"],
  "tags": ["wac", "site-info"],
  "summary": "<siteInfo value>",
  "status": "active"
}
```

Write `.aku/kus/ku_site/state.md` with the full `siteInfo` text as plain markdown content (no code fences).

### 5. Create Profile KUs

For each `[profileId, description]` pair in `profilesInfo`:

- Normalize the profile ID: replace hyphens and dots with underscores. Call this `normalizedId`.
- Create directory `.aku/kus/ku_profile_<normalizedId>/`.
- Write `manifest.json`:
```json
{
  "ku_id": "ku_profile_<normalizedId>",
  "ku_name": "<profileId> Profile",
  "ku_type": "profile",
  "keywords": ["<profileId>", "profile", "visitor"],
  "tags": ["wac", "profile"],
  "summary": "<description value>",
  "status": "active"
}
```
- Write `state.md` with the full description text as plain markdown content (no code fences).

### 6. Create Contact KU

Create directory `.aku/kus/ku_contact/`.

Write `.aku/kus/ku_contact/manifest.json`:
```json
{
  "ku_id": "ku_contact",
  "ku_name": "Owner Contact",
  "ku_type": "contact",
  "keywords": ["contact", "email", "phone", "owner"],
  "tags": ["wac", "contact"],
  "summary": "<contactInfo value>",
  "status": "active"
}
```

Write `.aku/kus/ku_contact/state.md` with the full `contactInfo` text as plain markdown content (no code fences).

### 7. Report Result

Output a plain text summary listing each KU created:
- The KU ID
- The KU type
- The directory path
- The KU name

Example output:
```
AKU created at /path/to/.aku
  ku_site (site) — Site Context
  ku_profile_developer (profile) — developer Profile
  ku_profile_qa_engineer (profile) — qa-engineer Profile
  ku_contact (contact) — Owner Contact
```

If any file write fails, report the error and stop. Do not attempt to clean up partial state.

## Constraints

- All JSON files use 2-space indentation.
- All directories are created with `recursive: true`.
- The `siteMap` array from WAC.json is not stored as a separate KU.
- Do not create `search-index.jsonl`, `index-meta.json`, `search-stats.json`, `ku-index.jsonl`, or any other index files.
- Do not create `lock` directories or `pending` directories.
- Use the current ISO 8601 timestamp for `createdAt`.
- Keep all output in English.
