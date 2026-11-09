export function referencedChart(bindings, family, name, screen) {
  const binding = bindings?.[family];
  if (!family || !Object.hasOwn(bindings ?? {}, family) || binding?.via !== "rows" || binding?.lifetime !== "attachment") throw new Error(`Undeclared row attachment ${family}`);
  if (binding.screen !== screen) throw new Error(`Row attachment ${family} has the wrong screen`);
  if (!name || !Object.hasOwn(binding.charts ?? {}, name)) throw new Error(`Row attachment ${family} has no chart ${name}`);
  return binding.charts[name];
}

export function resolveMachineReferences(root, bindings, screen) {
  const visit = (node) => {
    if (node.nodeType === 1) {
      if (node.hasAttribute("data-machine-ref")) {
        if (!node.hasAttribute("data-live")) throw new Error("data-machine-ref on a tag with no data-live");
        if (node.hasAttribute("data-machine")) throw new Error("data-machine-ref and data-machine cannot share a region");
        node.setAttribute("data-machine", JSON.stringify(referencedChart(bindings, node.getAttribute("data-cortex"), node.getAttribute("data-machine-ref"), screen)));
        node.removeAttribute("data-machine-ref");
      }
      if (node.localName === "template") visit(node.content);
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
}
