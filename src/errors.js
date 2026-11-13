// Fixed error kinds crossing module boundaries. Messages never carry
// untrusted input; the kind alone is the interface.

export const ERROR_KINDS = Object.freeze([
  'input_unreadable',
  'invalid_json',
  'invalid_snapshot',
  'invalid_input',
  'limit_exceeded',
  'credential_detected',
  'output_error',
  'usage_error',
  'internal_error'
]);

export class CatalogError extends Error {
  constructor(kind) {
    if (!ERROR_KINDS.includes(kind)) {
      throw new TypeError(`unknown error kind: ${String(kind)}`);
    }
    super('');
    this.name = 'CatalogError';
    this.kind = kind;
  }
}

export const inputUnreadable = () => new CatalogError('input_unreadable');
export const invalidJson = () => new CatalogError('invalid_json');
export const invalidSnapshot = () => new CatalogError('invalid_snapshot');
export const limitExceeded = () => new CatalogError('limit_exceeded');
export const credentialDetected = () => new CatalogError('credential_detected');
export const outputError = () => new CatalogError('output_error');
