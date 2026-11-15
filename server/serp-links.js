export function displayedHost(result) {
  try {
    const shown = result.displayed_link?.split(/\s*[›·]\s*/)[0];
    return new URL(shown || result.link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function trustedHost(host, domains) {
  return domains.some(domain => host === domain || host.endsWith('.' + domain));
}

// SerpAPI sometimes supplies an opaque google.com/goto URL. Resolve only
// shortlisted results, so citations point to the actual publisher.
export async function sourceLink(result) {
  try {
    const url = new URL(result.link);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'www.google.com' || url.pathname !== '/goto') return url.href;
    const response = await fetch(url, { signal: AbortSignal.timeout(6500) });
    response.body?.cancel();
    const target = new URL(response.url);
    return target.protocol === 'https:' && target.hostname !== 'www.google.com' ? target.href : null;
  } catch {
    return null;
  }
}
