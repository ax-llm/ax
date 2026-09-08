var __ax_host_namespaces = Object.create(null);
function __ax_bind_host_namespaces() {
  const roots = [];
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (name.indexOf('.') < 0) continue;
    const callable = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!callable || typeof callable.value !== 'function') continue;
    const parts = name.split('.');
    if (parts.some(part => !part)) {
      throw new Error('Invalid host callable namespace: ' + name);
    }
    let target = globalThis;
    let path = '';
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      path += (index ? '.' : '') + part;
      let entry = Object.getOwnPropertyDescriptor(target, part);
      if (!entry) {
        const value = Object.create(null);
        Object.defineProperty(target, part, {value, enumerable: true});
        __ax_host_namespaces[path] = value;
        entry = {value};
      }
      if (entry.value !== __ax_host_namespaces[path]) {
        throw new Error('Host callable namespace conflicts with a global: ' + path);
      }
      target = entry.value;
    }
    const leaf = parts[parts.length - 1];
    const existing = Object.getOwnPropertyDescriptor(target, leaf);
    if (existing && existing.value !== callable.value) {
      throw new Error('Host callable name conflicts with a namespace: ' + name);
    }
    if (!existing) Object.defineProperty(target, leaf, {value: callable.value, enumerable: true});
    if (roots.indexOf(parts[0]) < 0) roots.push(parts[0]);
  }
  if (Array.isArray(globalThis.__ax_session_reserved)) {
    for (const root of roots) {
      if (globalThis.__ax_session_reserved.indexOf(root) < 0) globalThis.__ax_session_reserved.push(root);
    }
  }
  return roots;
}
