# INDEX.md

## Conv: src/{layer}/{name}.ts
## Shared: src/shared/{name}.ts

## Keywords → Nodes
chat,message,send,edit,delete,thread → @chat
channel,room,join,leave,members → @channels

## Keywords → Skills
postgres,pg,RLS,pool,transaction,advisory lock → $postgres
valkey,redis,cache,pubsub,TTL → $valkey
websocket,ws,connection,ping,pong → $websocket
jwt,token,refresh,JWKS,claims,bearer → $jwt
docker,container,image,Dockerfile,compose → $docker

## Nodes → Clusters → Files
@chat = [chat] → src/handlers/ + src/domain/
@channels = [channels] → src/handlers/ + src/domain/

## Skills → Files
$postgres → .arch/skills/postgres.skill
$valkey → .arch/skills/valkey.skill
$websocket → .arch/skills/websocket.skill
$jwt → .arch/skills/jwt.skill
$docker → .arch/skills/docker.skill

## Cross-Refs
@chat → @channels (messages belong to channels)
