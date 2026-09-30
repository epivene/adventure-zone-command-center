// Hosted on the API origin so Secure/Lax interaction cookies remain first-party.
// Owner bearer stays in this page's memory and is never placed in a URL/storage.
export const consentScript = String.raw`
(() => {
  const $ = id => document.getElementById(id);
  const uid = new URLSearchParams(location.search).get('interaction');
  let token = '', details;
  const labels = {
    'crm:read':'Read profiles, history, saved document text and follow-ups',
    'crm:append':'Create researched leads and append notes',
    'crm:update':'Edit note text with saved history; propose profile changes and apply exact owner-approved changes',
    'drafts:write':'Save and edit app drafts',
    'followups:write':'Create and edit follow-up reminders'
  };
  async function request(path, body, csrf) {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-Connection-CSRF'] = csrf;
    const response = await fetch(path, {credentials:'same-origin',headers,
      ...(body !== undefined ? {method:'POST',body:JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!response.ok) throw Error(data.message || data.error || 'Request failed. Start again from ChatGPT.');
    return data;
  }
  if (!uid) { $('error').textContent = 'Missing connection request. Start again from ChatGPT.'; $('login').hidden = true; return; }
  const route = '/api/chatgpt-connection/interactions/' + encodeURIComponent(uid);
  $('login').addEventListener('submit', async event => {
    event.preventDefault(); $('error').textContent = ''; $('sign-in').disabled = true;
    try {
      const password = $('password').value; $('password').value = '';
      token = (await request('/api/auth/login', {password})).token;
      details = await request(route);
      $('client').textContent = details.clientName;
      $('return-address').textContent = 'Return address: ' + details.redirectUri;
      $('scopes').replaceChildren();
      for (const scope of details.requestedScopes) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.value = scope; input.checked = scope === 'crm:read';
        input.addEventListener('change', () => { $('allow').disabled = !document.querySelector('#scopes input:checked'); });
        label.append(input, document.createTextNode(labels[scope] || scope)); $('scopes').append(label);
      }
      $('allow').disabled = !document.querySelector('#scopes input:checked');
      $('login').hidden = true; $('consent').hidden = false;
    } catch (e) { token = ''; $('error').textContent = e.message; }
    finally { $('sign-in').disabled = false; }
  });
  async function decide(approve) {
    $('allow').disabled = true; $('deny').disabled = true; $('error').textContent = '';
    try {
      const scopes = Array.from(document.querySelectorAll('#scopes input:checked'), input => input.value);
      const result = await request(route, {approve,scopes}, details.csrfToken);
      const target = new URL(result.redirectTo, location.origin);
      if (target.origin !== location.origin || !target.pathname.startsWith('/api/chatgpt/oauth/')) throw Error('Invalid authorization redirect');
      token = ''; location.assign(target.href);
    } catch(e) { $('error').textContent = e.message; $('allow').disabled = !document.querySelector('#scopes input:checked'); $('deny').disabled = false; }
  }
  $('allow').addEventListener('click', () => decide(true));
  $('deny').addEventListener('click', () => decide(false));
})();`;
export function consentHtml(nonce: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Command Center connection</title><style nonce="${nonce}">body{font:16px system-ui;margin:0;background:#fafafa;color:#222}main{max-width:36rem;margin:2rem auto;padding:1rem}label{display:block;margin:1rem 0}input[type=password]{display:block;box-sizing:border-box;width:100%;padding:.7rem}input[type=checkbox]{margin-right:.6rem}button{padding:.8rem;margin:.5rem .5rem .5rem 0}p{overflow-wrap:anywhere}[hidden]{display:none!important}#error{color:#a00}</style></head><body><main><h1>Authorize Command Center access</h1><p>Sign in on this API host to review this connection. Your password is used only for the existing Command Center owner login.</p><p id="error" role="alert"></p><form id="login"><label>Owner password<input id="password" type="password" autocomplete="current-password" required></label><button id="sign-in" type="submit">Sign in to review</button></form><section id="consent" hidden><h2 id="client"></h2><p id="return-address"></p><p>Select what this connection may do. Profile overwrites need separate approval of the exact changes. This connection cannot send email or run app AI.</p><fieldset><legend>Requested permissions</legend><div id="scopes"></div></fieldset><button id="allow" type="button">Allow selected permissions</button><button id="deny" type="button">Deny</button></section></main><script nonce="${nonce}">${consentScript}</script></body></html>`;
}
