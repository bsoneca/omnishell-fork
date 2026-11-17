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
  const queue = [entry]
  while (queue.length > 0) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const src = await Deno.readTextFile(new URL(name, root))
    for (const spec of staticSpecs(src)) {
      if (!spec.startsWith("./") && !spec.startsWith("../")) continue
      queue.push(new URL(spec, new URL(name, root)).href.slice(root.href.length))
    }
  }
  return seen
}
