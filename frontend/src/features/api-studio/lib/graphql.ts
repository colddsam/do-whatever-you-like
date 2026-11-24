/**
 * GraphQL: fetch a schema by introspection, browse it, and build a query by ticking fields
 * (arguments become typed $variables), like Postman's GraphQL query builder.
 */

export const INTROSPECTION = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
  }
}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) { name description args { ...InputValue } type { ...TypeRef } isDeprecated deprecationReason }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue { name description type { ...TypeRef } defaultValue }
fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } } }`;

export type GqlTypeRef = { kind: string; name: string | null; ofType: GqlTypeRef | null };
export type GqlInput = { name: string; description?: string | null; type: GqlTypeRef; defaultValue?: string | null };
export type GqlField = { name: string; description?: string | null; args: GqlInput[]; type: GqlTypeRef; isDeprecated?: boolean };
export type GqlType = { kind: string; name: string; description?: string | null; fields: GqlField[] | null; inputFields: GqlInput[] | null; enumValues: { name: string }[] | null; possibleTypes: GqlTypeRef[] | null };
export type GqlSchema = { queryType: { name: string } | null; mutationType: { name: string } | null; subscriptionType: { name: string } | null; types: GqlType[] };

export function parseIntrospection(json: unknown): GqlSchema {
  const j = json as { data?: { __schema?: GqlSchema }; errors?: { message: string }[] };
  if (j?.data?.__schema) return j.data.__schema;
  if (j?.errors?.length) throw new Error(`The server refused introspection: ${j.errors[0].message}`);
  throw new Error("The answer wasn't a GraphQL schema. Is this a GraphQL endpoint, and is introspection on?");
}

export function typeString(t: GqlTypeRef | null): string {
  if (!t) return "";
  if (t.kind === "NON_NULL") return `${typeString(t.ofType)}!`;
  if (t.kind === "LIST") return `[${typeString(t.ofType)}]`;
  return t.name ?? "";
}

export function namedType(t: GqlTypeRef | null): string {
  let x = t;
  while (x && !x.name) x = x.ofType;
  return x?.name ?? "";
}

export const typeMap = (s: GqlSchema) => new Map(s.types.map((t) => [t.name, t]));

export function isLeaf(s: Map<string, GqlType>, t: GqlTypeRef): boolean {
  const k = s.get(namedType(t))?.kind;
  return k === "SCALAR" || k === "ENUM";
}

/** Selected paths look like "query/country/name": an operation, then fields. */
export function buildOperation(schema: GqlSchema, selected: Set<string>, opName = "MyQuery"): { query: string; variables: Record<string, unknown> } {
  const types = typeMap(schema);
  const ops: { kind: "query" | "mutation" | "subscription"; root: string | undefined }[] = [
    { kind: "query", root: schema.queryType?.name },
    { kind: "mutation", root: schema.mutationType?.name },
    { kind: "subscription", root: schema.subscriptionType?.name },
  ];
  const parts: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const op of ops) {
    if (!op.root) continue;
    const prefix = `${op.kind}/`;
    if (![...selected].some((p) => p.startsWith(prefix))) continue;
    const varDefs: string[] = [];
    const render = (typeName: string, path: string, depth: number): string => {
      const t = types.get(typeName);
      if (!t?.fields) return "";
      const lines: string[] = [];
      for (const f of t.fields) {
        const fp = `${path}/${f.name}`;
        if (!selected.has(fp)) continue;
        const args = f.args.length
          ? `(${f.args
              .filter((a) => a.type.kind === "NON_NULL" || selected.has(`${fp}(${a.name})`))
              .map((a) => {
                const v = `${f.name}_${a.name}`.replace(/[^A-Za-z0-9_]/g, "_");
                if (!varDefs.some((d) => d.startsWith(`$${v}:`))) {
                  varDefs.push(`$${v}: ${typeString(a.type)}`);
                  variables[v] = sampleValue(types, a.type);
                }
                return `${a.name}: $${v}`;
              })
              .join(", ")})`
          : "";
        const pad = "  ".repeat(depth);
        if (isLeaf(types, f.type)) lines.push(`${pad}${f.name}${args === "()" ? "" : args}`);
        else {
          let inner = render(namedType(f.type), fp, depth + 1);
          if (!inner) inner = `${"  ".repeat(depth + 1)}__typename`;
          lines.push(`${pad}${f.name}${args === "()" ? "" : args} {\n${inner}\n${pad}}`);
        }
      }
      return lines.join("\n");
    };
    const body = render(op.root, op.kind, 1);
    const name = op.kind === "query" ? opName : `${opName}${op.kind[0].toUpperCase()}${op.kind.slice(1)}`;
    parts.push(`${op.kind} ${name}${varDefs.length ? `(${varDefs.join(", ")})` : ""} {\n${body}\n}`);
  }
  return { query: parts.join("\n\n"), variables };
}

function sampleValue(types: Map<string, GqlType>, t: GqlTypeRef): unknown {
  if (t.kind === "NON_NULL") return sampleValue(types, t.ofType!);
  if (t.kind === "LIST") return [sampleValue(types, t.ofType!)];
  const nt = types.get(t.name ?? "");
  if (!nt) return null;
  if (nt.kind === "ENUM") return nt.enumValues?.[0]?.name ?? "";
  if (nt.kind === "INPUT_OBJECT") return Object.fromEntries((nt.inputFields ?? []).filter((f) => f.type.kind === "NON_NULL").map((f) => [f.name, sampleValue(types, f.type)]));
  switch (nt.name) {
    case "Int":
      return 0;
    case "Float":
      return 0.0;
    case "Boolean":
      return true;
    case "ID":
      return "1";
    default:
      return "";
  }
}

/** Ticking a field also ticks its parents (a field can't be selected inside an unselected object). */
export function toggleField(selected: Set<string>, path: string): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) {
    for (const p of [...next]) if (p === path || p.startsWith(`${path}/`) || p.startsWith(`${path}(`)) next.delete(p);
  } else {
    const segs = path.split("/");
    for (let i = 2; i <= segs.length; i++) next.add(segs.slice(0, i).join("/"));
  }
  return next;
}
