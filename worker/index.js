const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ALLOWED_GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/token') {
      return new Response('Not Found', { status: 404, headers: corsHeaders(env) });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_request', error_description: 'Malformed JSON body' }, 400, env);
    }

    const { grant_type: grantType } = payload;
    if (!ALLOWED_GRANT_TYPES.has(grantType)) {
      return jsonResponse({ error: 'unsupported_grant_type' }, 400, env);
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: grantType,
    });

    if (grantType === 'authorization_code') {
      if (!payload.code || !payload.redirect_uri) {
        return jsonResponse({ error: 'invalid_request', error_description: 'Missing code or redirect_uri' }, 400, env);
      }
      params.set('code', payload.code);
      params.set('redirect_uri', payload.redirect_uri);
      if (payload.code_verifier) params.set('code_verifier', payload.code_verifier);
    } else {
      if (!payload.refresh_token) {
        return jsonResponse({ error: 'invalid_request', error_description: 'Missing refresh_token' }, 400, env);
      }
      params.set('refresh_token', payload.refresh_token);
    }

    const googleResponse = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const body = await googleResponse.text();
    return new Response(body, {
      status: googleResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
    });
  },
};
