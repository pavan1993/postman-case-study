import http from 'node:http';

const MOCK_PORT = Number(process.env.MOCK_PORT) || 4010;
const RATE_LIMIT_HEADER = 'x-demo-rate-limit';
const BAD_REQUEST_HEADER = 'x-demo-bad-request';
const HAPPY_PATH_REFUND_ID = 'rfnd_demo123';

const ROUTES = [
  {
    method: 'POST',
    match: (pathname) => (pathname === '/auth/token' ? {} : null),
    handler: (_req, res) => {
      sendJson(res, 200, {
        access_token: 'demo.jwt.token',
        token_type: 'Bearer',
        expires_in: 300,
      });
    },
  },
  {
    method: 'GET',
    match: (pathname) => (pathname === '/health' ? {} : null),
    handler: (_req, res) => {
      sendJson(res, 200, { status: 'ok' });
    },
  },
  {
    method: 'POST',
    match: (pathname) => (pathname === '/refunds' ? {} : null),
    handler: (req, res) => {
      if (headerEquals(req, BAD_REQUEST_HEADER, '1')) {
        sendJson(res, 400, {
          error: 'bad_request',
          message: 'Invalid refund request (demo)',
        });
        return;
      }
      sendJson(res, 201, refundResponse());
    },
  },
  {
    method: 'GET',
    match: (pathname) => (pathname === '/refunds' ? {} : null),
    handler: (_req, res) => {
      sendJson(res, 200, { refunds: [refundResponse()] });
    },
  },
  {
    method: 'GET',
    match: (pathname) => refundPath(pathname, 'details'),
    handler: (req, res, match) => {
      if (!isHappyPathRefund(match)) {
        return sendRefundNotFound(res);
      }
      sendJson(res, 200, refundResponse(match.refundId));
    },
  },
  {
    method: 'GET',
    match: (pathname) => refundPath(pathname, 'status'),
    handler: (req, res, match) => {
      if (!isHappyPathRefund(match)) {
        return sendRefundNotFound(res);
      }
      sendJson(res, 200, {
        refundId: match.refundId,
        status: 'PENDING',
      });
    },
  },
  {
    method: 'POST',
    match: (pathname) => refundPath(pathname, 'cancel'),
    handler: (req, res, match) => {
      if (!isHappyPathRefund(match)) {
        return sendRefundNotFound(res);
      }
      sendJson(res, 200, {
        refundId: match.refundId,
        status: 'CANCELLED',
      });
    },
  },
];

function headerEquals(req, name, expected) {
  return (req.headers[name] || '').toString() === expected;
}

function refundPath(pathname, typeFilter) {
  const base = '/refunds/';
  if (!pathname.startsWith(base)) return null;
  const parts = pathname.slice(base.length).split('/');
  const refundId = parts[0];
  if (!refundId) return null;
  if (parts.length === 1) {
    const data = { type: 'details', refundId };
    return !typeFilter || typeFilter === data.type ? data : null;
  }
  if (parts[1] === 'status') {
    const data = { type: 'status', refundId };
    return !typeFilter || typeFilter === data.type ? data : null;
  }
  if (parts[1] === 'cancel' && parts.length === 2) {
    const data = { type: 'cancel', refundId };
    return !typeFilter || typeFilter === data.type ? data : null;
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

function sendRefundNotFound(res) {
  sendJson(res, 404, {
    error: 'not_found',
    message: 'Refund not found (demo)',
  });
}

function isHappyPathRefund(match) {
  return match?.refundId === HAPPY_PATH_REFUND_ID;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (headerEquals(req, RATE_LIMIT_HEADER, '1')) {
    sendJson(res, 429, {
      error: 'rate_limited',
      message: 'Rate limit exceeded (demo)',
    });
    return;
  }

  let matchedRoute = null;
  let matchData = null;
  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const data = route.match(url.pathname);
    if (data) {
      matchedRoute = route;
      matchData = data;
      break;
    }
  }

  if (matchedRoute) {
    matchedRoute.handler(req, res, matchData);
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(MOCK_PORT, () => {
  console.log(`Mock server listening on ${MOCK_PORT}`);
});
