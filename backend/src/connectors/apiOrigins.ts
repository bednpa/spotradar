/**
 * Fixed API origins of booking systems whose source config carries only ids (no URL).
 * Connectors, the stub fetch and `sourceHost` all use these, so the limiter, warnings and
 * back-off key on the same host.
 */
export const PADELOS_API_ORIGIN = 'https://api.padelos.co';
export const REZZY_API_ORIGIN = 'https://www.rezzy.eu';
export const FIRESTORE_API_ORIGIN = 'https://firestore.googleapis.com';
