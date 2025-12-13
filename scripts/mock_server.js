import http from 'node:http';

const MOCK_PORT = Number(process.env.MOCK_PORT) || 4010;
const ROUTES = {
  'POST /auth/token': (res) => {
    sendJson(res, 200, {
      access_token: 'demo.jwt.token',
      token_type: 'Bearer',
      expires_in: 300,
    });
  },
  'GET /health': (res) => {
    sendJson(res, 200, { status: 'ok' });
  },
  'POST /refunds': (res) => {
    sendJson(res, 201, refundResponse());
  },
  'GET /refunds/rfnd_demo123': (res) => {
    sendJson(res, 200, refundResponse());
  },
  'GET /refunds/rfnd_demo123/status': (res) => {
    sendJson(res, 200, {
      refundId: 'rfnd_demo123',
      status: 'PENDING',
    });
  },
  'POST /refunds/rfnd_demo123/cancel': (res) => {
    sendJson(res, 200, {
      refundId: 'rfnd_demo123',
      status: 'CANCELLED',
    });
  },
  'GET /refunds': (res) => {
    sendJson(res, 200, { refunds: [refundResponse()] });
  },
};

function refundResponse() {
  return {
    refundId: 'rfnd_demo123',
    transactionId: 'txn_demo123',
    status: 'PENDING',
    refundAmount: 10.5,
    refundCurrency: 'USD',
    links: {
      self: '/refunds/rfnd_demo123',
      status: '/refunds/rfnd_demo123/status',
      cancel: '/refunds/rfnd_demo123/cancel',
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
  const key = `${req.method} ${req.url}`;
  const handler = ROUTES[key];

  if (handler) {
    handler(res);
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(MOCK_PORT, () => {
  console.log(`Mock server listening on ${MOCK_PORT}`);
});
