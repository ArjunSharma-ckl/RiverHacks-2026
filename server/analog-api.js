import { displayedHost, sourceLink, trustedHost } from './serp-links.js';

const domains = ['nasa.gov', 'usgs.gov', 'esa.int', 'nih.gov', 'cdc.gov', 'noaa.gov', 'jaxa.jp', 'nps.gov'];
const scholarship = ['edu', 'iop.org', 'harvard.edu', 'sagepub.com', 'nature.com', 'wiley.com', 'springer.com', 'sciencedirect.com'];

export async function research(params, key) {
  if (!key) throw Error("SerpApi unavailable");
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  if (!q) throw Error("Missing query");
  const query = new URLSearchParams({
    engine:
      params.get("category") === "news"
        ? "google_news"
        : params.get("category") === "site"
          ? "google_scholar"
          : "google",
    api_key: key,
    q,
    num: "12",
  });
  const response = await fetch("https://serpapi.com/search.json?" + query, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("Research unavailable");
  const data = await response.json();
  if (data.error) throw Error("Research unavailable");
  const allowed = params.get('category') === 'site' ? [...domains,...scholarship] : domains;
  const candidates = (
      data.organic_results ??
      data.news_results?.flatMap((story) => [
        story,
        ...(story.stories ?? []),
      ]) ??
      []
    ).filter(r => trustedHost(displayedHost(r), allowed) && r.title && r.snippet).slice(0, 5);
  const resolved = await Promise.all(candidates.map(async r => {
    const link = await sourceLink(r);
    if (!link || !trustedHost(new URL(link).hostname, allowed)) return null;
    return { title:r.title, link, snippet:r.snippet, date:r.date,
      category:params.get('category') ?? 'research', source:new URL(link).hostname };
  }));
  const results = resolved.filter(Boolean);
  return { results, summary: results.slice(0, 3).map(r => ({text:r.snippet, link:r.link, source:r.source})) };
}
