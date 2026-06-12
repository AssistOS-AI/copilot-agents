---
name: create-akus
description: Create an Agentic Knowledge Units (.aku) directory from WAC JSON embedded in the prompt, including fetched siteMap documents, KU folders, root aggregate indexes, and search stats compatible with Achilles AgenticKnowledgeUnits.
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

## Required Output Layout

Treat the current working directory as the site project root and create:

```text
.aku/
  aku.json
  search-index.jsonl
  search-stats.json
  index-meta.json
  ku-index.jsonl
  documents-index.jsonl
  files-index.jsonl
  links-index.jsonl
  results-index.jsonl
  events-index.jsonl
  kus/
    <ku_id>/
      manifest.json
      state.md
      history.md
      events.jsonl
      documents/
        documents.jsonl
      results/
        results.jsonl
      support/
        files.jsonl
      links/
        links.jsonl
      sessions/
        sessions.jsonl
      code/
      data/
```

Create all directories with recursive filesystem operations. Write JSON with 2-space indentation. Write JSONL files with one JSON object per line or as an empty file when there are no records.

## Compatibility Rules

Use the current Achilles `AgenticKnowledgeUnits` file shapes:

`.aku/aku.json`:
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

Supported statuses are `active`, `validated`, `accepted`, `provisional`, `archived`, `invalidated`, `obsolete`, `discarded`, and `failure_note`. Normal search excludes `discarded` and `obsolete`.

## KU Creation Strategy

Create these KUs:

1. `ku_site_overview`
   - `ku_type`: `internal_document`
   - Combines `siteInfo` and `contactInfo`.
   - Include `site`, `wac`, `assistos`, and `contact` keywords when relevant.

2. One profile KU per `profilesInfo` entry
   - KU id: `ku_profile_<normalized_profile_id>`, lowercased, with non-alphanumeric characters converted to `_`.
   - `ku_type`: `business_analysis`
   - Preserve the profile text exactly in `documents/profile.md`.
   - Summarize the profile in `manifest.summary` and `state.md`; do not remove the original profile content from the document file.

3. One document KU per successfully fetched `siteMap` URL
   - KU id: `ku_doc_<slug>`, derived from the filename or URL path.
   - `ku_type`: choose from the implemented free-form KU type field using the closest conceptual type, such as `specification`, `internal_document`, `architecture_decision`, or `research_note`.
   - Store fetched markdown in `documents/source.md`.
   - Add one document record to `documents/documents.jsonl`.
   - Add the source URL to record metadata.

4. Failed siteMap fetches
   - Do not invent missing content.
   - Record an event in `ku_site_overview/events.jsonl` with `event_type: "fetch_failure"`, `status: "failure_note"`, and a summary containing the URL and error.

## State And Records

For every KU:
- `state.md` is a compact agent-readable current state with sections for identity, purpose, current findings, important files, reusable findings, and next actions.
- `history.md` is a short history. Do not put long fetched documents in history.
- `events.jsonl` contains at least one creation event.
- `documents/documents.jsonl` lists document records when a KU has stored markdown documents.
- `support/files.jsonl`, `links/links.jsonl`, `results/results.jsonl`, and `sessions/sessions.jsonl` must exist even when empty.

Document records use:
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
  "path": "kus/<ku_id>/documents/<file>.md",
  "created_at": "<ISO timestamp>",
  "updated_at": "<ISO timestamp>",
  "actor": "webassist",
  "metadata": {}
}
```

Event records use:
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

## Aggregate Indexes

Build root indexes after creating all KU folders. Fast AKU search reads aggregate root files instead of opening each KU folder.

Create:
- `ku-index.jsonl`: one compact KU search record per KU.
- `documents-index.jsonl`: one record per document record.
- `files-index.jsonl`, `links-index.jsonl`, `results-index.jsonl`: empty unless you create those record types.
- `events-index.jsonl`: one compact record per event.
- `search-index.jsonl`: denormalized union of KU, document, file, link, result, and event records.
- `search-stats.json`: BM25F stats for `search-index.jsonl`.
- `index-meta.json`: record counts and file hashes for root index files.

Search records must use the implemented fields:
- `search_id`
- `record_type`
- `ku_id`
- `ku_type`
- `ku_status`
- type-specific id fields when applicable
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

Use these search fields for stats: `keywords`, `tags`, `title`, `reusable_findings`, `summary`, `type`, `path`.

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

Tokenize conservatively for stats: lowercase words, preserve acronyms as searchable terms by lowercasing them, split punctuation and hyphenated terms, and skip common stopwords for document frequency.

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

If `.aku/aku.json` cannot be created, stop and report the error. Do not clean up partial state unless the user explicitly asks.
