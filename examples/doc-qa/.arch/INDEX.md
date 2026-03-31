# INDEX.md

## Conv: src/chains/{name}.py | src/prompts/{scope}/{name}.md | src/adapters/{type}/{name}.py
## Shared: src/ports/{name}.py | src/guardrails/{name}.py

## Keywords → Nodes
RAG,retrieve,document,search,context,citation → @rag
summarize,summary,condense,extract → @summarize

## Keywords → Skills
openai,anthropic,claude,embedding → $llm_sdk
pgvector,vector,embedding,HNSW,similarity → $pgvector
langfuse,trace,span,LLM observability → $langfuse
postgres,pg,RLS,pool,transaction,advisory lock → $postgres
valkey,redis,cache,pubsub,TTL → $valkey
docker,container,image,Dockerfile,compose → $docker

## Nodes → Clusters → Files
@rag = [rag] → src/chains/ + src/prompts/
@summarize = [summarize] → src/chains/ + src/prompts/

## Skills → Files
$llm_sdk → .arch/skills/llm_sdk.skill
$pgvector → .arch/skills/pgvector.skill
$langfuse → .arch/skills/langfuse.skill
$postgres → .arch/skills/postgres.skill
$valkey → .arch/skills/valkey.skill
$docker → .arch/skills/docker.skill

## Cross-Refs
@summarize → @rag (summarization uses the same document retrieval pipeline)
