/**
 * GitHub search via the GitHub REST API.
 * Set GITHUB_TOKEN env var for authenticated requests (higher rate limit, private repos).
 */
export async function githubSearch(query, { org, repo, type = 'code' } = {}) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'KINET/1.0',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  let endpoint, params;

  switch (type) {
    case 'issues':
    case 'prs': {
      const q = buildQuery(query, org, repo, type === 'prs' ? 'is:pr' : 'is:issue');
      endpoint = 'https://api.github.com/search/issues';
      params = new URLSearchParams({ q, per_page: '10' });
      break;
    }
    case 'commits': {
      if (!repo || !org) throw new Error('org and repo are required for commit search');
      endpoint = `https://api.github.com/repos/${org}/${repo}/commits`;
      params = new URLSearchParams({ q: query, per_page: '10' });
      break;
    }
    case 'code':
    default: {
      const q = buildQuery(query, org, repo);
      endpoint = 'https://api.github.com/search/code';
      params = new URLSearchParams({ q, per_page: '10' });
      break;
    }
  }

  const res = await fetch(`${endpoint}?${params}`, { headers });

  if (res.status === 403) {
    return [{ error: 'GitHub API rate limit exceeded. Set GITHUB_TOKEN env var for authenticated requests.' }];
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return formatResults(data, type);
}

function buildQuery(query, org, repo, extra = '') {
  const parts = [query];
  if (org && !repo) parts.push(`org:${org}`);
  if (repo && org) parts.push(`repo:${org}/${repo}`);
  else if (repo) parts.push(`in:file`);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

function formatResults(data, type) {
  if (type === 'code') {
    return (data.items || []).map(i => ({
      file: i.path,
      repo: i.repository?.full_name,
      url: i.html_url,
      sha: i.sha,
    }));
  }
  if (type === 'issues' || type === 'prs') {
    return (data.items || []).map(i => ({
      title: i.title,
      number: i.number,
      state: i.state,
      url: i.html_url,
      body: i.body?.slice(0, 300),
    }));
  }
  return data.items || data;
}
