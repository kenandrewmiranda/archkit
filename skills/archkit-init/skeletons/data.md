---
archetype: data
displayName: Data / Pipelines / Analytics / BI
description: A system whose core work is moving, transforming, and analyzing data — ETL/ELT pipelines, data warehouses, BI dashboards, embedded analytics, ML feature pipelines. SQL and orchestration are first-class; the request/response loop is secondary.
useWhen:
  - The job is to ingest data from sources, transform it, and make it queryable.
  - You operate a data warehouse (or want to) and run scheduled transformation jobs against it.
  - The product is dashboards, reports, or analytics — either standalone or embedded in another app.
  - SQL is the primary language for the work; orchestrated DAGs of jobs are the primary unit of architecture.
  - Data freshness, data quality, and warehouse cost are real product concerns.
redFlags:
  - You just need a database for a normal CRUD app — that's `saas`.
  - The model is the product (chatbot, agent) — that's `ai`.
  - Sub-second multi-client updates are core — that's `realtime`.
  - One-off CSV manipulation that runs a few times then stops — that's a script, not an archetype.
  - Embedded analytics are a small feature inside a SaaS product — pick `saas` and add Cube/Recharts as a feature, not the whole stack.
boundariesRef: archkit-boundaries-data
recommendedSkills:
  - archkit-skill-dbt
  - archkit-skill-dagster
  - archkit-skill-snowflake
  - archkit-skill-airbyte
  - archkit-skill-data-quality

deploymentModes:
  - id: managed
    label: Managed (cloud warehouse + managed orchestration + managed BI)
    why: |
      Cloud warehouse (Snowflake, BigQuery, Databricks, or MotherDuck) handles the storage and compute; managed ingestion (Fivetran, Airbyte Cloud, Stitch) handles the source connectors; dbt Cloud or Dagster Cloud handles orchestration; Hex, Metabase Cloud, or Looker handles the BI surface. Right default for almost every data product because operating a data warehouse, running an Airflow cluster, and writing your own source connectors are each meaningful engineering investments that compound when combined. Managed costs are real (warehouse spend especially) but predictable and trackable.
  - id: selfHosted
    label: Self-hosted (your own warehouse, your own orchestrator, your own BI)
    why: |
      Postgres or Clickhouse as the warehouse, Airbyte OSS or Meltano for ingestion, Dagster or Airflow on K3s for orchestration, dbt Core for transformation, Metabase or Superset for BI. Right default when warehouse spend is high enough to justify operating Clickhouse yourself, when data residency requires the warehouse to stay in your perimeter, or when you have data engineering capacity. The trade is non-trivial: a self-hosted data stack is the heaviest infrastructure of any archetype in this list — multiple stateful services, scheduled jobs that must actually run reliably, and storage that grows monotonically.

stack:
  primary:
    - name: SQL
      role: primary transformation language — most data work is SQL, regardless of which engine runs it
    - name: Python
      role: orchestration code, custom transformations, ML feature pipelines, source connectors
      alt: TypeScript (for embedded analytics + JS-shop teams), Scala/Java (legacy big-data ecosystems)
    - name: dbt (Core or Cloud)
      role: transformation framework — versioned SQL models with tests, lineage, and documentation; the de facto standard for warehouse transformation
      alt: SQLMesh (newer, virtualized environments), bare SQL files orchestrated by Airflow (more code, less convention)
    - name: TypeScript + Next.js
      role: app shell for any user-facing surface (custom dashboards, embedded analytics, admin console)
      optional: true
    - name: Snowflake or BigQuery or Databricks SQL
      role: cloud data warehouse — columnar storage, separated compute, scales horizontally on demand
      mode: managed
      alt: MotherDuck (DuckDB-based, cheaper for small-to-medium data), Redshift Serverless
    - name: Fivetran or Airbyte Cloud
      role: managed source connectors — pull data from SaaS APIs, databases, files into the warehouse
      mode: managed
      alt: Stitch, Hevo, custom connectors via Airbyte CDK
    - name: dbt Cloud
      role: hosted dbt — version control, scheduling, IDE, lineage UI
      mode: managed
      alt: dbt Core run via Dagster Cloud, GitHub Actions cron
    - name: Hightouch or Census
      role: reverse ETL — push warehouse data back into operational tools (Salesforce, HubSpot, marketing automation)
      mode: managed
      alt: custom workers, Airbyte's nascent reverse-ETL offering
      optional: true
    - name: Clickhouse
      role: self-hosted columnar warehouse — extremely fast for analytical queries, materialized views as a primary feature
      mode: selfHosted
      alt: PostgreSQL with Citus or pg_duckdb (smaller scale), DuckDB embedded (single-process analytics), TimescaleDB (time-series specifically), StarRocks
    - name: Airbyte OSS
      role: self-hosted ingestion — same connectors as Airbyte Cloud, run in your cluster
      mode: selfHosted
      alt: Meltano (Singer-based, Python-first), custom Python connectors
    - name: dbt Core
      role: self-hosted dbt — runs anywhere Python runs
      mode: selfHosted
    - name: Postgres CDC via Debezium
      role: change data capture from source databases into the warehouse without polling
      mode: selfHosted
      alt: Estuary Flow (managed CDC), custom WAL readers
      optional: true
  why: |
    The data archetype is the most stack-divergent in this taxonomy because the entire architecture revolves around the *warehouse* — the choice of warehouse engine cascades through every other decision (transformation, BI, ingestion, observability). **Managed** (Snowflake / BigQuery + Fivetran + dbt Cloud + Hex) is the right starting answer for almost everyone because each of those products solves a problem that takes a real engineering team to solve well in-house. **Self-hosted** (Clickhouse + Airbyte OSS + dbt Core + Metabase on K3s) is appropriate when warehouse spend dominates your budget, when data residency forbids cloud warehouses, or when you have data engineering capacity. dbt is non-negotiable in either mode — versioned, tested, documented SQL transformations are the discipline that separates "we have a warehouse" from "we have a working data platform."
  tradeoffs: |
    For embedded analytics inside another product (a "Reports" tab in your SaaS), you usually don't need a separate warehouse — read replicas of your operational Postgres + Cube as a semantic layer + Recharts/Tremor for visualizations is dramatically simpler. The full data archetype is for cases where data is the product (Mixpanel-shape) or where the volume genuinely exceeds what an operational database handles. MotherDuck is interesting as a hybrid managed/self-hosted: DuckDB locally, cloud-backed when needed, often the right pick for sub-terabyte workloads.

hosting:
  primary:
    - name: Snowflake / BigQuery / Databricks
      role: warehouse storage + compute, autoscaled by the provider
      mode: managed
      alt: MotherDuck, Redshift Serverless
    - name: dbt Cloud or Dagster Cloud
      role: managed orchestration — scheduled runs, lineage UI, alerting
      mode: managed
      alt: Astronomer (managed Airflow), Prefect Cloud, GitHub Actions cron (for very simple cases)
    - name: Hex, Metabase Cloud, Looker, Mode
      role: managed BI — dashboards, ad-hoc SQL, scheduled reports
      mode: managed
      alt: Evidence (markdown-based BI, Git-versioned), Tableau Cloud
    - name: Vercel
      role: app shell for embedded analytics or custom dashboards
      mode: managed
      alt: Railway, Fly.io
    - name: K3s on Hetzner with stateful storage
      role: hosts the orchestrator, BI tool, and (optionally) the warehouse — stateful services need persistent volumes, not ephemeral storage
      mode: selfHosted
      alt: Docker Compose on a single VM (acceptable for very small data; not for production warehouses), full K8s
    - name: Clickhouse on the cluster
      role: warehouse — runs as a stateful service with replication for any production-grade deployment
      mode: selfHosted
      alt: managed Clickhouse Cloud (still managed but on Clickhouse), Postgres for sub-terabyte cases
    - name: Dagster, Airflow, or Mage on the cluster
      role: orchestrator — schedules and tracks DAG runs, exposes a UI
      mode: selfHosted
      alt: Prefect (Python-friendly), Kestra (YAML-driven, JVM)
    - name: Metabase or Superset on the cluster
      role: BI surface
      mode: selfHosted
      alt: Lightdash (dbt-aware), Redash (older but works)
    - name: MinIO or S3
      role: object storage for raw extracts, dbt artifacts, intermediate files
      mode: selfHosted
      alt: directly to managed S3 even in self-hosted mode (S3 itself is so cheap and reliable that running MinIO is rarely worth it)
  why: |
    Data infrastructure is genuinely heavier than any other archetype because every component is stateful — the warehouse holds your data, the orchestrator's metadata DB tracks every run, the BI tool caches dashboards, the object store holds raw extracts. **Managed** outsources every stateful component to providers whose entire business is operating them. **Self-hosted** means running each one with appropriate persistence, backups, monitoring, and upgrades. Don't underestimate this: a self-hosted data stack with three or four stateful services on K3s is a real ongoing operational commitment, even with modest data volumes.
  tradeoffs: |
    Mix and match where it makes sense — managed warehouse (Snowflake) + self-hosted dbt Core orchestration (Dagster on K3s) is a common middle path that controls warehouse cost while avoiding the harder problem of self-hosting the warehouse. Don't run object storage yourself unless data residency requires it; managed S3 is essentially free at most data scales.

auth:
  primary:
    - name: Service accounts for pipeline-to-pipeline auth
      role: orchestrator → warehouse, source connector → orchestrator — most data infra runs on long-lived service credentials, not human auth
    - name: Secrets manager
      role: store warehouse credentials, source-system API keys, third-party tokens — never in environment files committed to repos
    - name: Clerk or WorkOS
      role: SSO for the BI tool and any user-facing dashboard surface
      mode: managed
      alt: Auth.js, Supabase Auth, the BI tool's own SSO integration
    - name: Per-user warehouse roles
      role: when humans run ad-hoc queries against the warehouse, role-based access controls scope what they can see
      mode: managed
      alt: row-level security policies in Snowflake/BigQuery for stricter isolation
      optional: true
    - name: Keycloak federated to BI tools
      role: self-hosted SSO — Metabase, Superset, and most BI tools support OIDC/SAML
      mode: selfHosted
      alt: Authelia in front of the BI tool as an identity-aware proxy
  why: |
    Data system auth has two distinct concerns. Most of the surface is *machine-to-machine* — orchestrators talking to warehouses, connectors pulling from source APIs — and the right answer is service accounts with credentials managed in a secrets manager (1Password, Doppler, AWS Secrets Manager, Bitwarden Secrets). The other concern is *human access* — the BI tool, ad-hoc warehouse queries, dashboard viewers — which uses standard SSO. Failing to separate these is a common source of data leaks; never use a personal warehouse credential as a service account, and rotate service credentials on a schedule.
  tradeoffs: |
    For embedded analytics inside another app, the user's identity from the host app authorizes both the dashboard view and the underlying query — usually via row-level security policies pinned to the user's tenant. Cube and similar semantic-layer tools enforce this cleanly.

networking:
  primary:
    - name: Source connector APIs
      role: REST, GraphQL, JDBC, S3 — connectors pull data from sources on schedule or via webhook
    - name: Webhook receivers for event ingestion
      role: real-time event capture (Snowplow, Segment-style) instead of batched pulls
      optional: true
    - name: Postgres CDC via Debezium or logical replication
      role: capture every change to a source database without polling
      optional: true
    - name: Embedded analytics API
      role: when serving dashboards inside another product, expose a constrained query API (Cube, Hasura, custom GraphQL) rather than direct warehouse access
      optional: true
    - name: Reverse ETL syncs
      role: push warehouse data back into Salesforce, HubSpot, etc. — outbound integrations from the warehouse to operational tools
      optional: true
  why: |
    Data system "networking" is dominated by *integration*, not user-facing API design. Source connectors pulling from SaaS APIs need to handle pagination, rate limits, schema drift, and incremental sync state. Webhook ingestion is the right pattern for high-volume event data. CDC is the right pattern for keeping a warehouse in sync with an operational database without polling overhead. The user-facing API surface is small — usually just whatever powers your dashboards or embedded analytics — and benefits from a semantic-layer tool (Cube, Hasura) that abstracts SQL into a typed API.
  tradeoffs: |
    Avoid building source connectors yourself unless absolutely necessary — Airbyte and Fivetran together cover hundreds of sources, and writing connectors well (incremental sync, schema evolution, retry semantics) is more work than it looks. Build a custom connector only when the source is exotic enough that no open-source connector exists and the data is critical.

ui:
  primary:
    - name: Hex, Metabase, or Superset
      role: ad-hoc analysis + scheduled reports + shareable dashboards — the standard BI surface
    - name: Tailwind + Recharts or Tremor
      role: custom dashboards or embedded analytics inside an app
      optional: true
    - name: Cube
      role: semantic layer — defines metrics and dimensions once in YAML, queryable from any frontend or BI tool
      optional: true
    - name: Visx or Vega-Lite
      role: more flexible / custom visualization needs that Recharts can't cover
      optional: true
    - name: Evidence
      role: markdown + SQL BI as code — dashboards are git-versioned files, not point-and-click artifacts
      optional: true
  why: |
    BI surfaces split into two camps: *exploration* (ad-hoc SQL, drag-and-drop dashboards for analysts and stakeholders, served by Hex / Metabase / Looker / Superset) and *embedded* (production dashboards inside a customer-facing or internal product, served by your own React app with Recharts / Tremor / Visx). For embedded, a semantic layer (Cube) is the lever that prevents your frontend code from accumulating ad-hoc SQL — you define metrics once in YAML and the frontend queries them by name. Evidence is an interesting newer option for teams that want BI dashboards versioned in git instead of clicked together in a UI; it fits well with the "everything as code" sensibility of dbt.
  tradeoffs: |
    Use Hex for technical-team self-serve analysis (SQL-native, notebook-shaped). Use Metabase or Superset for less-technical stakeholders who want point-and-click dashboards. Use embedded React for analytics that are *part of your product* — no BI tool's embedding story is as good as your own UI in your own app.

jobs:
  primary:
    - name: Orchestrator (Dagster, Prefect, Airflow, Mage)
      role: schedule and run DAGs of data jobs, track lineage, expose UI for runs and failures — the *core* infrastructure piece for this archetype, more important than the warehouse choice
    - name: dbt jobs
      role: scheduled dbt runs (via dbt Cloud or wired into Dagster) — the warehouse transformation step inside the broader orchestration
    - name: Idempotent job design
      role: every job must be safe to re-run on the same input window — incremental models, MERGE semantics, idempotency keys; without this, retries duplicate data
    - name: dbt Cloud jobs
      role: scheduled, monitored dbt runs with Slack/email alerts
      mode: managed
    - name: Dagster Cloud or Prefect Cloud
      role: managed orchestrator — DAGs run in your environment, control plane managed
      mode: managed
      alt: Astronomer (managed Airflow), GitHub Actions cron (very simple cases only)
    - name: Dagster or Airflow on K3s
      role: self-hosted orchestrator with persistent metadata database
      mode: selfHosted
      alt: Mage (lighter, all-in-one), Kestra (YAML-driven)
  why: |
    Jobs are not a side concern in this archetype — *jobs are the core of the architecture*. Every dataset in your warehouse arrived because a job moved it there; every transformation that turned raw into reportable was a job; every dashboard refresh and reverse-ETL sync is a job. The orchestrator's job is to track these as a DAG, retry failures, surface lineage, and tell you when something broke. The single most common cause of data outages in self-built data systems is the *absence* of a real orchestrator — when "the pipeline" is a cron job that runs a Python script, no one knows when it last ran successfully or which downstream things broke when it failed. Idempotency is non-negotiable because retries will happen and re-running a non-idempotent job either duplicates data or skips it.
  tradeoffs: |
    For embedded analytics inside a normal product, the orchestrator can be much lighter — a few scheduled jobs in Inngest or BullMQ that refresh aggregations is enough; you don't need Dagster. Reach for a real orchestrator the moment you have more than a handful of interdependent jobs.

observability:
  primary:
    - name: Elementary or dbt source freshness
      role: data quality testing — assert non-null, uniqueness, referential integrity, freshness on every model; fail the pipeline when assertions break
    - name: Orchestrator's built-in run history + lineage
      role: which run of which job produced which dataset, when, and how long it took — Dagster, Prefect, dbt Cloud all surface this
    - name: Warehouse cost monitoring
      role: query cost, storage cost, compute usage by warehouse / by user / by job — costs spiral silently without active monitoring
    - name: Sentry
      role: error tracking for the app shell + custom orchestration code (the Python that runs your DAGs)
      mode: managed
      alt: Highlight.io
    - name: Monte Carlo or Bigeye
      role: managed data observability — anomaly detection on data freshness, volume, distribution
      mode: managed
      alt: Metaplane, Datafold
      optional: true
    - name: Elementary OSS + Soda Core
      role: self-hosted data quality + observability — Elementary builds on dbt artifacts, Soda runs assertions as standalone checks
      mode: selfHosted
      alt: re_data, Great Expectations (heavyweight, Python-first)
    - name: Grafana + Prometheus
      role: orchestrator metrics, warehouse query metrics, custom job metrics
      mode: selfHosted
      alt: SigNoz
  why: |
    "Observability" in data is fundamentally different from app observability. The questions are *did the data arrive*, *is the data correct*, *did the schema change*, *is the warehouse spend climbing*, and *can I trace this dashboard number back to the source row that produced it*. Standard application monitoring (Sentry) catches the orchestrator crashing but doesn't catch the silent failure modes that matter most: a successful pipeline run that produced wrong data because an upstream column was renamed and the join silently became cross-product. Data quality tests (dbt tests, Elementary, Soda) and lineage tracking (orchestrator-built-in or Datahub/OpenMetadata) are the tools that catch these. Warehouse cost monitoring is its own discipline — Snowflake/BigQuery spend can 10x overnight from one bad query.
  tradeoffs: |
    Skip dedicated data observability tools (Monte Carlo, Bigeye) until you have enough volume to need anomaly detection — Elementary + dbt tests cover the common cases for free. Skip lineage tooling (Datahub, OpenMetadata) until the warehouse has enough tables that "where does this come from" stops being answerable from memory.

testing:
  primary:
    - name: dbt tests
      role: data assertions on every model — non-null, unique, accepted_values, relationships; runs in every dbt invocation
    - name: Schema contracts
      role: dbt's `contract: enforced` (or equivalent) on important models — schema changes must be intentional, not accidental
    - name: Sample-data unit tests for transformation logic
      role: write small CSV inputs and assert expected outputs for complex transformations — dbt has unit testing built in for SQL transforms
    - name: Soda Core or Great Expectations checks
      role: data quality assertions outside of dbt — useful for raw landing tables before transformation
      optional: true
    - name: Orchestrator integration tests
      role: end-to-end DAG tests that run a full pipeline against a sandbox warehouse and assert outputs
      optional: true
  why: |
    Testing in data is shaped by the fact that the "correctness" being tested is *the data itself*, not just the code that produced it. dbt tests run as part of every transformation and fail the pipeline when assumptions break (a column that was supposed to be unique no longer is). Schema contracts catch silent drift when an upstream change would otherwise propagate quietly. Unit-testing transformation logic against fixed sample inputs is the right level for complex SQL — easier to debug than running against the full warehouse. The pipeline that *runs without erroring* but produces wrong data is the failure mode that data tests catch and traditional unit tests do not.
  tradeoffs: |
    Skip orchestrator integration tests unless you have a sandbox warehouse — they're valuable but expensive to maintain. Schema contracts are non-negotiable on any dbt model that's consumed by another model or by a dashboard.
---

# Data / Pipelines / Analytics / BI

This archetype is for systems whose core work is moving, transforming, and analyzing data. The shape covers ETL/ELT pipelines that load data from sources into a warehouse, dbt-based transformations that shape raw data into reportable form, BI surfaces that present the data to humans (Hex, Metabase, custom dashboards), embedded analytics inside other products (Cube + Recharts), and reverse-ETL syncs that push warehouse insights back into operational tools. ML feature pipelines fit here too — the model serving lives in `ai`, but the feature engineering and training data preparation are data work.

The architecture is fundamentally orchestrator-centric in a way no other archetype is. The most important question for any data system is "which jobs run when, in what order, and what happens when they fail?" — and the answer is a directed acyclic graph maintained by an orchestrator (Dagster, Prefect, Airflow, dbt Cloud) with versioned transformation logic on top (dbt). Get this layer right and adding new pipelines is a small change; get it wrong and "the pipeline" becomes a brittle hand-maintained sequence of cron jobs that nobody trusts.

## What data systems optimize for that other archetypes don't

Five concerns dominate decisions in this archetype:

1. **Idempotency is non-negotiable.** Every job must be safe to re-run on the same input window. Retries will happen — orchestrator failures, warehouse blips, network drops — and a non-idempotent job either duplicates rows or silently skips them. dbt incremental models, MERGE semantics, and explicit idempotency keys are the standard tools.
2. **Data quality is the actual correctness signal.** A pipeline that "ran successfully" but produced wrong data is the most common and most expensive failure mode in data systems. dbt tests, schema contracts, and tools like Elementary or Soda catch the cases that traditional application monitoring misses entirely.
3. **Warehouse cost can spiral silently.** Snowflake or BigQuery spend can 10x overnight from one bad query, one runaway dashboard, one schema change that turns an indexed scan into a full-table scan. Cost monitoring per-query, per-job, per-user is required from day one — not an optimization to do later.
4. **Schema evolution is a real engineering concern.** Source systems change column names, drop fields, change types. Without schema contracts and active monitoring, these changes propagate silently into your warehouse and break dashboards days later when someone notices the numbers look wrong.
5. **Lineage matters more here than anywhere else.** When a dashboard number looks wrong, the question "where did this column come from, what jobs produced it, what source table was it ultimately derived from" must be answerable. Orchestrators with first-class lineage (Dagster especially) and dbt's lineage graph are how this is maintained.

## The managed vs. self-hosted decision

For data, the operational gap between managed and self-hosted is wider than any other archetype because every component is stateful, every component runs on a schedule, and every component eventually needs upgrading without losing data. **Managed** (Snowflake / BigQuery + Fivetran + dbt Cloud + Hex) is dramatically less work and is the right starting answer for almost everyone, including teams that lean self-hosted in other archetypes. **Self-hosted** (Clickhouse + Airbyte OSS + Dagster + Metabase on K3s) is appropriate when warehouse spend dominates your budget at scale, when data residency forbids cloud warehouses, or when you have data engineering capacity. There is also a common middle path — managed warehouse + self-hosted orchestration — that lets you control transformation infrastructure while leaving the hardest stateful component (the warehouse itself) to specialists.

If your "data" needs are really just embedded charts in a SaaS app showing read replicas of operational Postgres, you don't need this archetype — pick `saas` and add Cube + Recharts as a feature inside it.
