import { createServer } from 'node:http';
import { request } from 'node:https';

const PORT = 3001;

const server = createServer((req, res) => {
  // Handle CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Request-ID, X-Retry-Count'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Get the target URL from query parameter
  const urlParts = req.url?.split('?url=');
  if (!urlParts || urlParts.length < 2) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing target URL parameter' }));
    return;
  }

  // Decode the URL parameter
  const targetUrl = decodeURIComponent(urlParts[1]);
  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Empty target URL' }));
    return;
  }

  // Parse the target URL
  let url;
  try {
    url = new URL(targetUrl);
  } catch (error) {
    console.error('Invalid URL:', targetUrl, error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid target URL', url: targetUrl }));
    return;
  }

  console.log(`Proxying request to: ${url.href}`);

  // Forward the request
  const proxyReq = request(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: url.hostname,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error', details: err.message }));
  });

  // Forward the request body
  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`CORS proxy running on http://localhost:${PORT}`);
  console.log(
    `Usage: http://localhost:${PORT}?url=${encodeURIComponent('https://api.openai.com/v1/chat/completions')}`
  );
});
