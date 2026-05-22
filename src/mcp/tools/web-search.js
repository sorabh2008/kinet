/**
 * Web search via Brave Search API (or DuckDuckGo instant answers as fallback).
 * Set BRAVE_API_KEY env var to use Brave. Without it, uses DuckDuckGo.
 */
export async function webSearch(query, maxResults = 5) {
  const apiKey = process.env.BRAVE_API_KEY;

  if (apiKey) {
    return braveSearch(query, maxResults, apiKey);
  }

  return duckDuckGoSearch(query, maxResults);
}

async function braveSearch(query, count, apiKey) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave Search API error: ${res.status}`);

  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

async function duckDuckGoSearch(query, count) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'KINET/1.0' } });

  if (!res.ok) throw new Error(`DuckDuckGo API error: ${res.status}`);

  const data = await res.json();
  const results = [];

  if (data.AbstractText) {
    results.push({ title: data.Heading, url: data.AbstractURL, description: data.AbstractText });
  }

  for (const topic of (data.RelatedTopics || []).slice(0, count - 1)) {
    if (topic.Text && topic.FirstURL) {
      results.push({ title: topic.Text.split(' - ')[0], url: topic.FirstURL, description: topic.Text });
    }
  }

  return results.slice(0, count);
}
