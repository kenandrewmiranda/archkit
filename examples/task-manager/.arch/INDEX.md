# INDEX.md

## Conv: src/features/{cluster}/{cluster}.{layer}.ts
## Shared: src/shared/{name}/index.ts | Jobs: src/jobs/{name}.ts

## Keywords → Nodes
task,todo,assign,status,priority → @tasks
login,logout,JWT,session,SSO → @auth
team,member,invite,role → @teams

## Keywords → Skills
prisma,schema,migration,include,select,relation → $prisma
valkey,redis,cache,pubsub,TTL → $valkey
bullmq,queue,job,worker,retry → $bullmq
keycloak,realm,OIDC,SAML,SSO config → $keycloak
docker,container,image,Dockerfile,compose → $docker

## Nodes → Clusters → Files
@tasks = [tasks] → src/features/tasks/
@auth = [auth] → src/features/auth/
@teams = [teams] → src/features/teams/

## Skills → Files
$prisma → .arch/skills/prisma.skill
$valkey → .arch/skills/valkey.skill
$bullmq → .arch/skills/bullmq.skill
$hono → .arch/skills/hono.skill
$zod → .arch/skills/zod.skill
$keycloak → .arch/skills/keycloak.skill
$docker → .arch/skills/docker.skill

## Cross-Refs
@tasks → @auth (tasks require authenticated user context)
@tasks → @teams (tasks are scoped to teams)
@teams → @auth (team invites require auth)
