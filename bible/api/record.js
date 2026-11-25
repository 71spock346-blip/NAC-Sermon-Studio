/*
 * The deacons' link as WhatsApp shows it (src/fill.js linkFor):
 *
 *   /service-record/Gezina#<code>     in Afrikaans  /diensrekord/Gezina#<code>
 *
 * vercel.json sends both addresses here. WhatsApp, like every app that shows a
 * link with a card, fetches the address without what follows the # and reads
 * the page's title, words and picture. So this page carries "Service Record
 * Gezina" with the Church's emblem for that card, and sends the browser on to
 * the deacon's page of the app (/#fill/<code>). The code after the # never
 * reaches this function: the browser keeps it, and only the page's own script
 * reads it.
 *
 * The congregation's name in the address is only a word for the card. Anything
 * but letters, digits, spaces, hyphens, full stops and apostrophes is dropped,
 * a hyphen is read as a space (Pretoria-East is Pretoria East), and what is
 * left is written into the page as text, never as code. The page may run
 * nothing but its own script (the Content-Security-Policy names its hash).
 */
import { createHash } from 'node:crypto';

const WORDS = {
  en: {
    title: 'Service Record',
    church: 'New Apostolic Church',
    about: 'New Apostolic Church. Open the link to fill in the record of the service.',
    opening: 'Opening the service record…',
  },
  af: {
    title: 'Diensrekord',
    church: 'Nuwe Apostoliese Kerk',
    about: 'Nuwe Apostoliese Kerk. Maak die skakel oop om die rekord van die diens in te vul.',
    opening: 'Die diensrekord word oopgemaak…',
  },
};

/** On to the deacon's page with the code; without a code that can be one, to the app's start. */
const GO = String.raw`(function(){var c=location.hash.replace(/^#\/?(fill\/)?/,'').replace(/[\s-]/g,'').toUpperCase();location.replace('/'+(/^[A-Z2-9]{20}$/.test(c)?'#fill/'+c:''));})();`;
const GO_HASH = createHash('sha256').update(GO).digest('base64');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The congregation as the address carries it, as a short plain name ('' when there is none). */
export function placeOf(raw) {
  return String(raw || '').normalize('NFC')
    .replace(/[^\p{L}\p{N}\s.'’-]/gu, '')
    .replace(/[\s-]+/g, ' ')
    .trim().slice(0, 40).trim();
}

/** This site's own address, for the picture (a card needs it whole); a host that is not a plain name is not trusted. */
function originOf(req) {
  const h = req.headers || {};
  let host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) host = 'nac.coskeys.co.za';
  const proto = String(h['x-forwarded-proto'] || '').split(',')[0].trim() === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}

export function page({ lang, place, origin }) {
  const w = WORDS[lang] || WORDS.en;
  const title = place ? `${w.title} ${place}` : w.title;
  return `<!DOCTYPE html>
<html lang="${lang === 'af' ? 'af' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(w.about)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0168b5">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(w.church)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(w.about)}">
<meta property="og:image" content="${esc(origin)}/icons/icon-512.png?v=2">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="${esc(w.church)}">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png?v=2">
<script>${GO}</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0168b5;color:#fff;font:16px/1.4 system-ui,sans-serif}</style>
</head>
<body><p>${esc(w.opening)}</p></body>
</html>
`;
}

export default function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }
  const lang = url.searchParams.get('lang') === 'af' ? 'af' : 'en';
  const body = Buffer.from(page({ lang, place: placeOf(url.searchParams.get('name')), origin: originOf(req) }), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${GO_HASH}'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(method === 'HEAD' ? undefined : body);
}
