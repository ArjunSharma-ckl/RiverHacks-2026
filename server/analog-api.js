export async function research(params, key) {
  if (!key) throw Error("SerpApi unavailable");
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  if (!q) throw Error("Missing query");
  const query = new URLSearchParams({
    engine: "google",
    api_key: key,
    q: q + " (site:nasa.gov OR site:usgs.gov OR site:esa.int)",
    num: "5",
  });
  const response = await fetch("https://serpapi.com/search.json?" + query, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("Research unavailable");
  const data = await response.json();
  if (data.error) throw Error("Research unavailable");
  return {
    results: (data.organic_results ?? [])
      .filter((r) =>
        /^https:\/\/([\w-]+\.)*(nasa\.gov|usgs\.gov|esa\.int)\//i.test(r.link),
      )
      .slice(0, 5)
      .map(({ title, link, snippet }) => ({ title, link, snippet })),
  };
}
