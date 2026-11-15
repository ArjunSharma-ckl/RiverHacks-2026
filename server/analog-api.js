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
  const all = (
      data.organic_results ??
      data.news_results?.flatMap((story) => [
        story,
        ...(story.stories ?? []),
      ]) ??
      []
    ).filter(r=>r.title&&r.snippet);
  const trusted = all.filter(r => trustedHost(displayedHost(r), allowed));
  const candidates = (trusted.length?trusted:all).slice(0,5);
  const resolved = await Promise.all(candidates.map(async r => {
    const link = await sourceLink(r);
    if (!link || trusted.length&&!trustedHost(new URL(link).hostname, allowed)) return null;
    return { title:r.title, link, snippet:r.snippet, date:r.date,
      category:params.get('category') ?? 'research', source:new URL(link).hostname };
  }));
  const results = resolved.filter(Boolean);
  return { results, summary: results.slice(0, 3).map(r => ({text:r.snippet, link:r.link, source:r.source})) };
}

// One SerpAPI request per uncached question. An available Google AI Overview is
// used verbatim; otherwise the response is an attributed digest of result text.
export async function answerQuestion(params, key) {
  if (!key) throw Error('SerpApi unavailable');
  const q = (params.get('q') ?? '').trim().slice(0, 200);
  if (!q) throw Error('Missing query');
  const query = new URLSearchParams({engine:'google',api_key:key,q,num:'8'});
  const response = await fetch('https://serpapi.com/search.json?' + query, {signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Research unavailable');
  const data = await response.json();
  if (data.error) throw Error('Research unavailable');
  const rows = [...(data.ai_overview?.references||[]), data.answer_box, ...(data.organic_results||[])].filter(Boolean);
  const sources = (await Promise.all(rows.slice(0,8).map(async row => {
    const link = await sourceLink(row);
    if (!link || !row.title) return null;
    return {title:row.title,link,snippet:String(row.snippet||row.answer||row.result||'').trim(),source:new URL(link).hostname};
  }))).filter(Boolean).slice(0,5);
  const flatten = block => {
    if(typeof block==='string')return block;
    if(!block||typeof block!=='object')return '';
    const lead=[block.title,block.snippet||block.text].filter(Boolean).join(' ');
    const nested=[...(block.text_blocks||[]),...(block.list||[])].map(flatten).filter(Boolean);
    return [lead,...nested].filter(Boolean).join(block.type==='list'?'\n':'\n\n');
  };
  const overview = (data.ai_overview?.text_blocks||[]).map(flatten).filter(Boolean).join('\n\n').trim().slice(0,5000);
  const answer = overview || sources.filter(x=>x.snippet).slice(0,4)
    .map(x=>`${x.snippet} (${x.source})`).join('\n\n');
  return {answer,answerType:overview?'AI overview':'Source digest',sources};
}
