#!/usr/bin/env node

// One-shot experimental Codex device endpoint probe for this plugin's own
// third-party registration.
// Deliberately never prints the request ID, user code, verification URI, client ID,
// or response body. This script makes exactly one POST and performs no polling.

const ENDPOINT = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const SAFE_FIELDS = [
  'deviceauthid',
  'device_auth_id',
  'usercode',
  'user_code',
  'verification_uri',
  'verification_uri_complete',
  'expires_in',
  'interval',
  'nonce',
  'client_id',
  'error',
  'error_code',
];
const SAFE_ERROR_IDENTIFIERS = new Set([
  'access_denied',
  'authorization_pending',
  'device_code_expired',
  'expired_token',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'slow_down',
  'unsupported_grant_type',
]);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function safeCode(value) {
  return typeof value === 'string' && SAFE_ERROR_IDENTIFIERS.has(value)
    ? value
    : undefined;
}

const clientId = (process.env.NOMAD_DEVICE_OAI_CLIENT_ID || await readStdin()).trim();
if (!/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId)) {
  process.stderr.write('Provide this plugin registration\u2019s oaiapp client ID through NOMAD_DEVICE_OAI_CLIENT_ID or stdin.\n');
  process.exit(2);
}

let response;
let body;
try {
  response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  // Read the response once; parse only in memory and never print its raw contents.
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ http_status: null, error_code: 'request_failed', fields: {} })}\n`);
  process.exit(1);
}

const fields = {};
if (body && typeof body === 'object' && !Array.isArray(body)) {
  for (const key of SAFE_FIELDS) {
    if (Object.hasOwn(body, key)) fields[key] = typeof body[key];
  }
  if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
    for (const key of ['type', 'code']) {
      if (Object.hasOwn(body.error, key)) fields[`error.${key}`] = typeof body.error[key];
    }
  }
}

const errorCode = safeCode(body?.error_code)
  ?? safeCode(body?.error)
  ?? safeCode(body?.error?.code)
  ?? safeCode(body?.error?.type);

const result = {
  http_status: response.status,
  ...(errorCode ? { error_code: errorCode } : {}),
  fields,
  ...(body && typeof body === 'object' && Number.isFinite(body.expires_in)
    ? { expires_in: body.expires_in }
    : {}),
  ...(body && typeof body === 'object' && Number.isFinite(body.interval)
    ? { interval: body.interval }
    : {}),
};

process.stdout.write(`${JSON.stringify(result)}\n`);
