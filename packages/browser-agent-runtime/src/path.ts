export function normalizeSandboxPath(input: string, cwd = "/workspace"): string {
  const raw = input.trim() || ".";
  const start = raw.startsWith("/") ? raw : `${cwd}/${raw}`;
  const parts: string[] = [];
  for (const part of start.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function dirname(path: string): string {
  const normalized = normalizeSandboxPath(path, "/");
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "/" : normalized.slice(0, idx);
}

export function basename(path: string): string {
  const normalized = normalizeSandboxPath(path, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

export function directChildName(parent: string, candidate: string): string | null {
  const normalizedParent = normalizeSandboxPath(parent, "/");
  const normalizedCandidate = normalizeSandboxPath(candidate, "/");
  if (normalizedParent === normalizedCandidate) return null;
  const prefix = normalizedParent === "/" ? "/" : `${normalizedParent}/`;
  if (!normalizedCandidate.startsWith(prefix)) return null;
  const rest = normalizedCandidate.slice(prefix.length);
  if (!rest || rest.includes("/")) return null;
  return rest;
}

