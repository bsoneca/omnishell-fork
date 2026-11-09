/** A transition value in every #Machine spelling — a bare target string, one
 * candidate object, or an ordered candidate list — as the list. */
export function machineCandidates(value) {
  if (typeof value === "string") return [{ target: value }];
  return Array.isArray(value) ? value : [value];
}

/**
 * One walk of a #Machine's value positions, shared by the interpreter (which
 * modules to load), the checkers (which references must resolve, which raises
 * must be handled), and the path walker (which arrows exist).
 *
 * `refs` are positions that are ALWAYS references (guards, non-numeric after
 * keys, and the `{type, params}` object form except where it names a leaf the
 * terminal answers itself);
 * `assignStrings` are dual positions — a string here is a reference exactly
 * when it names a declared module, and a literal otherwise.
 */
/** Leaf types the terminal answers itself in the assign position, so no module
 * is looked up and no checker demands one for them there. */
export const RESERVED_LEAVES = new Set(["event"]);

/** Event leaves whose value the terminal has to MEASURE. Reading one costs a
 * synchronous layout, so a chart says whether it wants that by reading it: a
 * click carries clientX in every browser, and measuring on all of them would
 * put a reflow in front of every gesture in every app. */
const POINTER_FIELDS = new Set(["pointerX", "pointerY"]);

export function machineShape(machine) {
  let pointer = false;
  const refs = new Set();
  const assignStrings = new Set();
  const raises = new Set();
  const handled = new Set();
  const arrows = [];
  const effects = [];
  const invokes = [];
  const collectInvokes = (state, node) => {
    for (const spec of Array.isArray(node.invoke) ? node.invoke : node.invoke ? [node.invoke] : []) invokes.push({ state, spec });
  };
  collectInvokes("", machine);
  const walkActions = (actions) => {
    const list = Array.isArray(actions) ? actions : (actions ? [actions] : []);
    for (const act of list) {
      if (act.raise !== undefined) raises.add(act.raise);
      for (const v of Object.values(act.assign ?? {})) {
        if (typeof v === "string") assignStrings.add(v);
        else if (v !== null && typeof v === "object" && !RESERVED_LEAVES.has(v.type)) refs.add(v.type);
        else if (v !== null && typeof v === "object" && POINTER_FIELDS.has(v.params?.field)) pointer = true;
      }
      const rawEffects = Array.isArray(act.effect) ? act.effect : (act.effect ? [act.effect] : []);
      for (const eff of rawEffects) {
        effects.push(eff);
        for (const v of Object.values(eff.values ?? {})) {
          if (typeof v === "string") assignStrings.add(v);
          else if (v !== null && typeof v === "object" && !RESERVED_LEAVES.has(v.type)) refs.add(v.type);
          else if (v !== null && typeof v === "object" && POINTER_FIELDS.has(v.params?.field)) pointer = true;
        }
      }
    }
  };
  const walk = (state, key, value) => {
    machineCandidates(value).forEach((c, index) => {
      arrows.push({ state, key, index });
      if (c.guard !== undefined) refs.add(typeof c.guard === "string" ? c.guard : c.guard.type);
      if (c.raise !== undefined) raises.add(c.raise);
      for (const v of Object.values(c.assign ?? {})) {
        if (typeof v === "string") assignStrings.add(v);
        else if (v !== null && typeof v === "object" && !RESERVED_LEAVES.has(v.type)) refs.add(v.type);
        else if (v !== null && typeof v === "object" && POINTER_FIELDS.has(v.params?.field)) pointer = true;
      }
      const rawEffects = Array.isArray(c.effect) ? c.effect : (c.effect ? [c.effect] : []);
      for (const eff of rawEffects) {
        effects.push(eff);
        for (const v of Object.values(eff.values ?? {})) {
          if (typeof v === "string") assignStrings.add(v);
          else if (v !== null && typeof v === "object" && !RESERVED_LEAVES.has(v.type)) refs.add(v.type);
          else if (v !== null && typeof v === "object" && POINTER_FIELDS.has(v.params?.field)) pointer = true;
        }
      }
      if (c.actions) walkActions(c.actions);
    });
  };
  for (const [key, value] of Object.entries(machine.on ?? {})) {
    handled.add(key.split("@")[0]);
    walk("*", key, value);
  }
  if (machine.onDone !== undefined) {
    walk("*", "onDone", machine.onDone);
  }
  const walkState = (name, s) => {
    collectInvokes(name, s);
    for (const [key, value] of Object.entries(s.on ?? {})) {
      handled.add(key.split("@")[0]);
      walk(name, key, value);
    }
    for (const [delay, value] of Object.entries(s.after ?? {})) {
      if (!/^\d+$/.test(delay)) refs.add(delay);
      walk(name, `after:${delay}`, value);
    }
    if (s.always !== undefined) {
      walk(name, "always", s.always);
    }
    if (s.onDone !== undefined) {
      walk(name, "onDone", s.onDone);
    }
    walkActions(s.entry);
    walkActions(s.exit);
    if (s.states) {
      for (const [subName, subState] of Object.entries(s.states)) {
        walkState(`${name}.${subName}`, subState);
      }
    }
  };
  for (const [name, s] of Object.entries(machine.states ?? {})) {
    walkState(name, s);
  }
  return {
    refs: [...refs],
    assignStrings: [...assignStrings],
    raises: [...raises],
    handled: [...handled],
    arrows,
    pointer,
    effects,
    invokes,
  };
}
