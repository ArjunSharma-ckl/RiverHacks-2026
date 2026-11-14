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
    q:
      q +
      " (site:nasa.gov OR site:usgs.gov OR site:esa.int OR site:nih.gov OR site:cdc.gov OR site:noaa.gov)",
    num: "5",
  });
  const response = await fetch("https://serpapi.com/search.json?" + query, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("Research unavailable");
  const data = await response.json();
  if (data.error) throw Error("Research unavailable");
  return {
    results: (data.organic_results ?? data.news_results ?? [])
      .filter((r) =>
        /^https:\/\/([\w-]+\.)*(nasa\.gov|usgs\.gov|esa\.int|nih\.gov|cdc\.gov|noaa\.gov)\//i.test(
          r.link,
        ),
      )
      .slice(0, 5)
      .map(({ title, link, snippet, date }) => ({
        title,
        link,
        snippet,
        date,
        source: new URL(link).hostname,
      })),
  };
}
