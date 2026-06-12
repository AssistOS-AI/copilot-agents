---
name: create-akus
description: Create a minimal Achilles-compatible Agentic Knowledge Units (.aku) directory from WAC JSON embedded in the prompt, including fetched siteMap documents and valid root indexes.
---

# Create AKUs

## Purpose

Use this skill when the prompt contains WAC JSON and asks you to create `.aku/` in the current project directory.

AKU means Agentic Knowledge Units. A Knowledge Unit (KU) is a local, reusable unit of work or knowledge: a site description, profile, document, specification, research note, result, validation, decision, or useful failure. AKU does not use LLM search infrastructure, embeddings, vector databases, RAG services, or external storage. Your job is to create deterministic local files that Achilles `AgenticKnowledgeUnits` can load and search later.

The WAC JSON has:
- `siteInfo`: site identity and overview text.
- `profilesInfo`: object mapping profile ids to full profile text.
- `contactInfo`: contact or local interaction information.
- `siteMap`: array of absolute URLs. Fetch every URL and use the fetched text as document source material.

## Required Minimal Layout

Treat the current working directory as the site project root. Create `.aku/` directly under it.

Root files required by Achilles:

```text
.aku/
  aku.json
  index-meta.json
  search-index.jsonl
  search-stats.json
  ku-index.jsonl
  documents-index.jsonl
  files-index.jsonl
  links-index.jsonl
  results-index.jsonl
  events-index.jsonl
  kus/
```

For each KU, create only the files and directories that are needed:

```text
.aku/kus/<ku_id>/
  manifest.json
  state.md
  history.md
  events.jsonl
```

For a KU with stored source text, also create:

```text
.aku/kus/<ku_id>/
  documents/
    source.md
    documents.jsonl
```

Do not create empty `code/`, `data/`, `sessions/`, `results/`, `support/`, or `links/` directories unless you also create records that require them. If a root index has no records, write it as an empty file. Write JSON with 2-space indentation. Write JSONL with one JSON object per line.

## Achilles Compatibility Rules

Achilles `AgenticKnowledgeUnits` receives the site project root as `rootDir` and looks for `.aku` inside it. The generated `.aku` must pass `AKUDoctor` checks. In particular:

- every root index file listed above must exist.
- every JSONL file must be parseable.
- `index-meta.json.files` must contain the real SHA256, byte length, and JSONL record count for every root index file.
- `search-stats.json.record_count` must equal the number of records in `search-index.jsonl`.
- `index-meta.json.record_counts.search` must equal the number of records in `search-index.jsonl`.
- root indexes must be generated from the KU folders under `.aku/kus`.

Use this `.aku/aku.json` shape:

```json
{
  "schema": 1,
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "ku_root_version": 0,
  "actor": "webassist",
  "metadata": {
    "source": "WAC.json",
    "generator": "opencodeAgent/create-akus"
  }
}
```

Each `manifest.json` must include:
- `schema: 1`
- `ku_id`, matching `^ku_[a-z0-9][a-z0-9_-]*$`
- `ku_name`
- `ku_type`
- `status`, usually `active`
- `created_at`, `updated_at`, `version: 1`
- `tags`, `keywords`
- `summary`
- `reusable_findings`
- `lineage: { "parent_ku_id": null, "forked_from": null }`
- `parent_ku_id: null`
- `outcome_status: null`
- `created_by`, `updated_by`, `actor`
- `source_operation: "create-akus"`

Supported statuses are `active`, `validated`, `accepted`, `provisional`, `archived`, `invalidated`, `obsolete`, `discarded`, and `failure_note`.

## KU Creation Strategy

Create these KUs:

1. `ku_site_overview`
   - `ku_type`: `internal_document`
   - Combine `siteInfo` and `contactInfo`.
   - Include relevant keywords such as `site`, `wac`, `assistos`, and `contact`.

2. One profile KU per `profilesInfo` entry
   - KU id: `ku_profile_<normalized_profile_id>`, lowercased, with non-alphanumeric characters converted to `_`.
   - `ku_type`: `business_analysis`
   - Preserve the profile text exactly in `documents/source.md`.
   - Add one document record to `documents/documents.jsonl`.
   - Summarize the profile in `manifest.summary` and `state.md`; do not remove the original profile content from the source document.

3. One document KU per successfully fetched `siteMap` URL
   - KU id: `ku_doc_<slug>`, derived from the filename or URL path.
   - `ku_type`: choose the closest conceptual type, such as `specification`, `internal_document`, `architecture_decision`, or `research_note`.
   - Store fetched markdown/text in `documents/source.md`.
   - Add one document record to `documents/documents.jsonl`.
   - Add the source URL to `metadata.source_url`.

4. Failed siteMap fetches
   - Do not invent missing content.
   - Record a `fetch_failure` event in `ku_site_overview/events.jsonl` with `status: "failure_note"` and a summary containing the URL and error.

## KU Source Files

`state.md` should be compact and agent-readable. Include only useful current state:

```markdown
# KU: <name>

## Identity
KU ID: `<ku_id>`
Type: `<ku_type>`
Status: `active`

## Current Purpose
<purpose>

## Current Findings
<short findings>

## Important Files
<paths, if any>

## Reusable Findings
<short reusable findings>
```

`history.md` can be short. Do not copy long fetched documents into history.

Each KU must have at least one creation event in `events.jsonl`:

```json
{
  "event_id": "evt_<safe_id>",
  "ku_id": "<ku_id>",
  "record_type": "event",
  "event_type": "created",
  "status": "active",
  "title": "<title>",
  "summary": "<summary>",
  "tags": [],
  "keywords": [],
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "actor": "webassist",
  "metadata": {}
}
```

Document KUs and profile KUs must include a document record:

```json
{
  "document_id": "doc_<safe_id>",
  "ku_id": "<ku_id>",
  "record_type": "document",
  "document_type": "markdown",
  "status": "active",
  "title": "<title>",
  "summary": "<short summary>",
  "tags": [],
  "keywords": [],
  "reusable_findings": [],
  "path": "kus/<ku_id>/documents/source.md",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "actor": "webassist",
  "metadata": {}
}
```

## Aggregate Indexes

Build root indexes after creating all KU folders. Fast AKU search reads aggregate root files instead of opening each KU folder.

Create compact records equivalent to Achilles index builder output:

- `ku-index.jsonl`: one KU search record per `manifest.json`.
- `documents-index.jsonl`: one document search record per `documents/documents.jsonl` record.
- `events-index.jsonl`: one event search record per `events.jsonl` record.
- `files-index.jsonl`, `links-index.jsonl`, `results-index.jsonl`: empty unless you actually create those record types.
- `search-index.jsonl`: denormalized union of KU, document, file, link, result, and event records.

Search records must use these fields when applicable:

- `search_id`
- `record_type`
- `ku_id`
- `ku_type`
- `ku_status`
- type-specific id fields such as `document_id` or `event_id`
- `status`
- `title`
- `summary`
- `type`
- `path`
- `tags`
- `keywords`
- `reusable_findings`
- `created_at`
- `updated_at`

Use these `search_id` formats:

- KU: `ku:<ku_id>`
- document: `document:<ku_id>:<document_id>`
- event: `event:<ku_id>:<event_id>`

Use these paths:

- KU: `kus/<ku_id>`
- document: `kus/<ku_id>/documents/source.md`

Use these fields for search stats: `keywords`, `tags`, `title`, `reusable_findings`, `summary`, `type`, `path`.

`search-stats.json` must use:

```json
{
  "schema": 1,
  "record_count": 0,
  "avg_field_lengths": {
    "keywords": 0,
    "tags": 0,
    "title": 0,
    "reusable_findings": 0,
    "summary": 0,
    "type": 0,
    "path": 0
  },
  "document_frequency": {},
  "bm25f": {
    "k1": 1.2,
    "field_weights": {
      "keywords": 6,
      "tags": 5,
      "title": 4,
      "reusable_findings": 3,
      "summary": 2,
      "type": 1,
      "path": 1
    },
    "field_b": {
      "keywords": 0,
      "tags": 0,
      "type": 0,
      "title": 0.35,
      "path": 0.35,
      "summary": 0.75,
      "reusable_findings": 0.75
    }
  },
  "built_at": "<ISO timestamp>"
}
```

Tokenize conservatively for stats: lowercase words, preserve acronyms by lowercasing them, split punctuation and hyphenated terms, and skip common stopwords for document frequency.

`index-meta.json` must use the Achilles shape:

```json
{
  "schema": 1,
  "generation_id": "idx_<timestamp>_<random>",
  "aku_schema": 1,
  "record_counts": {
    "search": 0,
    "ku": 0,
    "document": 0,
    "file": 0,
    "link": 0,
    "result": 0,
    "event": 0
  },
  "files": {
    "search-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "search-stats.json": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0
    },
    "ku-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "documents-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "files-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "links-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "results-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    },
    "events-index.jsonl": {
      "sha256": "<hex sha256 of exact file content>",
      "bytes": 0,
      "records": 0
    }
  },
  "source": {
    "ku_root_version": 0,
    "built_from": ".aku/kus",
    "build_options_hash": "<hex sha256 of stable build options>"
  },
  "generated_at": "<ISO timestamp>"
}
```

The `sha256`, `bytes`, and `records` values must be calculated after writing or finalizing the exact string content of each root index file. Do not use placeholder values.

## Fetching Rules

- Fetch every URL in `siteMap` before creating document KUs.
- Prefer plain text from the response body. Markdown files should be stored as markdown.
- If HTTP status is not 2xx or fetch throws, record a fetch failure event and continue with the remaining URLs.
- Keep fetched content local under `.aku/kus/<ku_id>/documents/source.md`.
- Do not store secrets, cookies, authorization headers, or environment variables in AKU files.

## Reporting

After writing files, print a plain English summary:
- `.aku` path
- number of KUs
- number of fetched documents
- number of failed fetches
- root index files created
