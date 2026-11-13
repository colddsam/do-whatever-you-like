/**
 * Tell IndexNow search engines (Bing, Yandex, Seznam, Naver…) that pages changed, so they recrawl
 * them now instead of eventually. Google doesn't use IndexNow; it reads the sitemap.
 *
 *   npm run indexnow                     every URL in the live sitemap
 *   npm run indexnow -- /tools/merge-pdf /about    just these paths
 *
 * Run it after a deploy. The key is public by design: search engines fetch
 * /<key>.txt (in public/) to confirm the request comes from the site's owner.
 */
const SITE = "https://do-whatever-you-like.colddsam.com";
const KEY = "563e9318598ec55dab9f0b5721509061";

const paths = process.argv.slice(2);
let urls;
if (paths.length) {
  urls = paths.map((p) => new URL(p, SITE).href);
} else {
  const res = await fetch(`${SITE}/sitemap.xml`);
  if (!res.ok) throw new Error(`Couldn't read the sitemap: HTTP ${res.status}`);
  urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
if (!urls.length) throw new Error("No URLs to submit.");

const keyCheck = await fetch(`${SITE}/${KEY}.txt`);
if (!keyCheck.ok || (await keyCheck.text()).trim() !== KEY) {
  throw new Error(`${SITE}/${KEY}.txt isn't live yet. Deploy first, then run this again.`);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
});
// 200 = accepted, 202 = accepted, key check pending. Anything else is an error worth reading.
console.log(`IndexNow: HTTP ${res.status} for ${urls.length} URLs`);
if (res.status >= 300) {
  console.error(await res.text());
  process.exit(1);
}
