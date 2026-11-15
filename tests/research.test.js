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

test('GroundTruth resolves Google redirect citations and accepts journal papers for Studies', async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).startsWith('https://serpapi.com/'))return Response.json({organic_results:[
      {title:'NASA analog report',snippet:'Icelandic terrain helps study Martian landforms.',link:'https://www.google.com/goto?url=opaque',displayed_link:'https://ntrs.nasa.gov › citations'},
      {title:'Peer-reviewed rover field test',snippet:'Researchers tested a rover in Iceland.',link:'https://iopscience.iop.org/article/example'}
    ]});
    return {url:'https://ntrs.nasa.gov/citations/123',body:null};
  });
  const result=await research(new URLSearchParams({q:'Iceland rover',category:'site'}),'test-key');
  assert.equal(result.results.length,2);
  assert.equal(result.results[0].link,'https://ntrs.nasa.gov/citations/123');
  assert.equal(result.summary.length,2);
  assert.equal(result.results[1].source,'iopscience.iop.org');
});
