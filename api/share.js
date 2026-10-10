// Vercel Function: render link-preview metadata from editable Supabase site settings.
// No secret credentials are needed: the existing website already uses the public anon key.
// Place this file at: api/share.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function getHtml() {
  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, '..', 'index.html')
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { /* try next */ }
  }
  throw new Error('Website index.html is unavailable to the Vercel Function.');
}

function readPublicConfig(html) {
  // Extract the same PUBLIC Supabase configuration that is used by index.html.
  // Do not add Supabase service-role or secret credentials here.
  const projectUrl = html.match(/\bconst\s+URL\s*=\s*['"](https:\/\/[^'"]+)['"]/);
  const publicKey = html.match(/\bconst\s+ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
  return {
    url: process.env.SUPABASE_URL || projectUrl?.[1],
    key: process.env.SUPABASE_ANON_KEY || publicKey?.[1]
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function setMeta(html, attribute, key, value) {
  const attr = attribute === 'property' ? 'property' : 'name';
  const search = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(<meta\\s+' + attr + '="' + search + '"\\s+content=")[^"]*(")', 'i');
  return html.replace(pattern, (_match, before, after) => before + escapeHtml(value) + after);
}

function applyMetadata(html, texts) {
  const name = typeof texts.shopName === 'string' ? texts.shopName.trim() : '';
  const description = typeof texts.aboutMeText === 'string' ? texts.aboutMeText.trim() : '';
  const subtitle = typeof texts.headerSubtitle === 'string' ? texts.headerSubtitle.trim() : '';
  if (!name) return html;
  const desc = description || subtitle || name;
  html = html.replace(/<title>[^<]*<\/title>/i, '<title>' + escapeHtml(name) + '</title>');
  for (const [attr,key,value] of [
    ['name','description',desc],
    ['property','og:site_name',name],
    ['property','og:title',name],
    ['property','og:description',desc],
    ['name','twitter:title',name],
    ['name','twitter:description',desc]
  ]) html = setMeta(html,attr,key,value);
  return html;
}

async function getSettings(html) {
  const {url,key} = readPublicConfig(html);
  if (!url || !key) throw new Error('Public Supabase configuration not found in index.html');
  const endpoint = new URL('/rest/v1/site_settings', url);
  endpoint.search = new URLSearchParams({select:'texts',id:'eq.1',limit:'1'}).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(endpoint.toString(), {
      headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Supabase returned HTTP ' + response.status);
    const data = await response.json();
    return data?.[0]?.texts || {};
  } finally { clearTimeout(timeout); }
}

module.exports = async function handler(req,res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow','GET, HEAD');
    return res.end();
  }
  let html;
  try { html = getHtml(); }
  catch (error) { console.error('Preview page unavailable:',error); return res.status(500).end('Website temporarily unavailable'); }
  try {
    const texts = await getSettings(html);
    html = applyMetadata(html, texts);
  } catch(error) {
    // Keep website usable even when Supabase is temporarily unavailable.
    console.warn('Link preview metadata fallback:',error.message);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method === 'HEAD') return res.end();
  return res.end(html);
};
