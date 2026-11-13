export async function resolve(specifier, context, nextResolve) {
  if (specifier === '../security/redact.js') {
    return { url: new URL('./redact.js', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
