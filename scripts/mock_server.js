import http from 'node:http';

const MOCK_PORT = Number(process.env.MOCK_PORT) || 4010;
const ROUTES = [
  {
    method: 'POST',
    match: (pathname) => pathname === '/auth/token',
    handler: (res) => {
      sendJson(res, 200, {
        access_token: 'demo.jwt.token',
        token_type: 'Bearer',
        expires_in: 300,
      });
    },
  },
  {
    method: 'GET',
    match: (pathname) => pathname === '/health',
    handler: (res) => {
      sendJson(res, 200, { status: 'ok' });
    },
  },
  {
    method: 'POST',
    match: (pathname) => pathname === '/refunds',
    handler: (res) => {
      sendJson(res, 201, refundResponse());
    },
  },
  {
    method: 'GET',
    match: (pathname) => pathname === '/refunds',
    handler: (res) => {
      sendJson(res, 200, { refunds: [refundResponse()] });
    },
  },
  {
    method: 'GET',
    match: (pathname) => refundPath(pathname)?.type === 'details',
    handler: (res, match) => {
      sendJson(res, 200, refundResponse(match.refundId));
    },
  },
  {
    method: 'GET',
    match: (pathname) => refundPath(pathname)?.type === 'status',
    handler: (res, match) => {
      sendJson(res, 200, {
        refundId: match.refundId,
        status: 'PENDING',
      });
    },
  },
  {
    method: 'POST',
    match: (pathname) => refundPath(pathname)?.type === 'cancel',
    handler: (res, match) => {
      sendJson(res, 200, {
        refundId: match.refundId,
        status: 'CANCELLED',
      });
    },
  },
];

function refundPath(pathname) {
  const base = '/refunds/';
  if (!pathname.startsWith(base)) return null;
  const parts = pathname.slice(base.length).split('/');
  const refundId = parts[0];
  if (!refundId) return null;
  if (parts.length === 1) {
    return { type: 'details', refundId };
  }
  if (parts[1] === 'status') {
    return { type: 'status', refundId };
  }
  if (parts[1] === 'cancel' && parts.length === 2) {
    return { type: 'cancel', refundId };
  }
  return null;
}

function refundResponse(refundId = 'rfnd_demo123') {
  return {
    refundId,
    transactionId: 'txn_demo123',
    status: 'PENDING',
    refundAmount: 10.5,
    refundCurrency: 'USD',
    links: {
      self: `/refunds/${refundId}`,
      status: `/refunds/${refundId}/status`,
      cancel: `/refunds/${refundId}/cancel`,
    },
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = ROUTES.find(
    (entry) => entry.method === req.method && entry.match(url.pathname)
  );

  if (route) {
    const matchData = route.match(url.pathname);
    route.handler(res, matchData);
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(MOCK_PORT, () => {
  console.log(`Mock server listening on ${MOCK_PORT}`);
});
