import test from "node:test";
import assert from "node:assert/strict";
import { research } from "../server/analog-api.js";
test("GroundTruth selects engines, filters sources and keeps citations attached", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = new URL(url);
    return Response.json({
      organic_results: [
        {
          title: "Analog evidence",
          snippet: "Field observations",
          date: "2025",
          link: "https://science.nasa.gov/example",
        },
        { title: "Unverified", link: "https://nasa.gov.other.com/" },
      ],
    });
  });
  for (const [category, engine] of [
    ["site", "google_scholar"],
    ["incident", "google"],
    ["news", "google_news"],
  ]) {
    const { results } = await research(
      new URLSearchParams({ q: "Atacama", category }),
      "test-key",
    );
    assert.equal(requested.searchParams.get("engine"), engine);
    assert.equal(results.length, 1);
    assert.equal(results[0].source, "science.nasa.gov");
    assert.equal(results[0].date, "2025");
  }
  await assert.rejects(research(new URLSearchParams({ q: "field" }), ""));
});
