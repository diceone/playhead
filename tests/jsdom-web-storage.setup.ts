// Node >= 22 defines a global `localStorage`/`sessionStorage` object that is
// non-functional unless started with `--localstorage-file`. It shadows the
// real storage from the jsdom window global, so re-expose the jsdom versions.
for (const prop of ["localStorage", "sessionStorage"] as const) {
  const existing = Object.getOwnPropertyDescriptor(globalThis, prop);
  const current = existing ? (existing.get ? existing.get.call(globalThis) : existing.value) : globalThis[prop];
  const jsdomStorage = (globalThis as { jsdom?: { window: Window } }).jsdom?.window?.[prop];
  const isBroken = !current || typeof (current as { clear?: unknown }).clear !== "function";
  if (jsdomStorage && typeof jsdomStorage.clear === "function" && isBroken) {
    Object.defineProperty(globalThis, prop, {
      value: jsdomStorage,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
}