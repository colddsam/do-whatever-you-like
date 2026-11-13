/** Calls one of the developer-tool routes (app/api/tools/devtools/[action]) and returns its JSON, or throws its message. */
export async function postJson<T>(action: "dns" | "reverse" | "port" | "http" | "xsd" | "xslt", body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/tools/devtools/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.detail === "string" ? data.detail : null) ?? "That didn't work. Try again.");
  return data as T;
}
