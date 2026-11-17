// The static import closure of a module under interpreter/: `import ... from`, `export ... from` and bare
// `import "x"`, multi-line included, relative specifiers (`./` and `../`) resolved against the importing module.
// Dynamic import() calls are not followed; they are how xstate stays lazy.
export const interpreterRoot = new URL("../interpreter/", import.meta.url)

export function staticSpecs(src: string): string[] {
  return [
    ...src.matchAll(/(?:^|[\n;])\s*(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']/g),
    ...src.matchAll(/(?:^|[\n;])\s*import\s*["']([^"']+)["']/g),
  ].map((m) => m[1])
}

export async function staticClosure(entry: string, root: URL = interpreterRoot): Promise<Set<string>> {
  const seen = new Set<string>()
  const visited = new Set<string>()
  const queue = [new URL(entry, root).href]
  while (queue.length > 0) {
    const href = queue.shift()!
    if (visited.has(href)) continue
    visited.add(href)
    // Names are interpreter-relative; a module outside the root is walked but not named.
    if (href.startsWith(root.href)) seen.add(href.slice(root.href.length))
    const src = await Deno.readTextFile(new URL(href))
    for (const spec of staticSpecs(src)) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue
      queue.push(new URL(spec, href).href)
    }
  }
  return seen
}
