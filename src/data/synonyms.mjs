// Bidirectional synonym groups — if any word in a group appears in a prompt,
// all words in that group are added to the search terms.
export const SYNONYM_GROUPS = [
  ["payment", "billing", "charge", "invoice", "subscription", "plan"],
  ["auth", "authenticate", "login", "logout", "session", "jwt", "token", "sso", "password", "mfa"],
  ["user", "account", "profile", "member"],
  ["tenant", "workspace", "organization", "org", "company"],
  ["database", "db", "postgres", "sql", "query", "migration"],
  ["cache", "redis", "valkey", "ttl", "session"],
  ["search", "index", "facet", "filter", "meilisearch"],
  ["queue", "job", "worker", "async", "background", "bullmq"],
  ["storage", "upload", "file", "image", "s3", "minio"],
  ["email", "notification", "alert", "push", "sms"],
  ["test", "spec", "unit", "integration", "e2e"],
  ["deploy", "ci", "cd", "pipeline", "docker", "k8s", "kubernetes"],
  ["api", "endpoint", "route", "controller", "rest", "graphql"],
  ["repo", "repository", "data access", "dal"],
  ["service", "business logic", "domain"],
  ["event", "emit", "subscribe", "publish", "bus", "webhook"],
  ["error", "exception", "throw", "catch", "handler"],
  ["validate", "validation", "schema", "zod", "input"],
  ["permission", "role", "rbac", "acl", "access", "authorize"],
  ["chat", "message", "conversation", "thread"],
  ["realtime", "websocket", "socket", "live", "presence"],
  ["product", "catalog", "item", "sku", "inventory"],
  ["cart", "checkout", "order", "purchase"],
  ["dashboard", "analytics", "metrics", "chart", "report"],
];

export function expandWithSynonyms(words) {
  const expanded = new Set(words);
  for (const word of words) {
    for (const group of SYNONYM_GROUPS) {
      if (group.includes(word)) {
        group.forEach(syn => expanded.add(syn));
      }
    }
  }
  return [...expanded];
}
