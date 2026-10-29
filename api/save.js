// Vercel serverless function: commits the edited page to GitHub (index.html on main).
// Env vars (set in Vercel): GITHUB_TOKEN, EDIT_PASSWORD, GITHUB_REPO (owner/name), optional GITHUB_BRANCH (default main).
const crypto = require('crypto');

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function fail(res, status, code, error) { return res.status(status).json({ code, error }); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method', 'POST only');
  const { GITHUB_TOKEN, EDIT_PASSWORD, GITHUB_REPO } = process.env;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!GITHUB_TOKEN || !EDIT_PASSWORD || !GITHUB_REPO) return fail(res, 500, 'not_configured', 'Server env vars are missing');

  const body = req.body || {};
  if (!same(body.password || '', EDIT_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800));
    return fail(res, 401, 'bad_password', 'Wrong password');
  }
  const html = body.html;
  if (typeof html !== 'string' || !/^<!doctype html/i.test(html) || !html.includes('id="state"') || html.length > 2000000)
    return fail(res, 400, 'invalid_content', 'Not a valid page');

  const api = `https://api.github.com/repos/${GITHUB_REPO}/contents/index.html`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'secura-mkt-editor',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  try {
    const cur = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    let sha;
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) return fail(res, 502, 'github_read', `GitHub read failed (${cur.status})`);

    const put = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Edit Secura GTM map from the site',
        content: Buffer.from(html, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) return fail(res, 502, 'github_write', `GitHub write failed (${put.status})`);
    const out = await put.json();
    return res.status(200).json({ ok: true, commit: out.commit && out.commit.sha });
  } catch (e) {
    return fail(res, 502, 'network', 'Could not reach GitHub');
  }
};
