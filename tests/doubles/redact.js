export function redactText(text) {
  return text.replace(/example-secret/g, '[MASKED]').slice(0, 200);
}
