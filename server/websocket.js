const WebSocket = require('ws');

let wss = null;

function init(server, sessionMiddleware) {
  // noServer mode lets us run the session middleware on the upgrade request
  // so ws.session.userId is available on each connection.
  wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const run = sessionMiddleware
      ? (cb) => sessionMiddleware(req, {}, cb)
      : (cb) => cb();
    run(() => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.subscribedContracts = new Set();
    ws.userId = req.session?.userId || null;

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe' && msg.contractId) {
          ws.subscribedContracts.add(String(msg.contractId));
        }
        if (msg.type === 'unsubscribe' && msg.contractId) {
          ws.subscribedContracts.delete(String(msg.contractId));
        }
      } catch (e) {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {});
  });

  // Heartbeat every 30s to detect dead connections
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  console.log('WebSocket server ready');
}

function broadcast(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Contract-specific events only go to subscribers; global events go to all
    const contractSpecific = ['price_update', 'trade_executed', 'orderbook_update'];
    if (contractSpecific.includes(msg.type) && msg.contractId) {
      if (!ws.subscribedContracts.has(String(msg.contractId))) return;
    }
    ws.send(data);
  });
}

function broadcastAll(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

// Unique userIds across currently-open sockets. A single user with several
// tabs counts once.
function getActiveUserIds() {
  if (!wss) return [];
  const ids = new Set();
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN && ws.userId) ids.add(ws.userId);
  });
  return Array.from(ids);
}

module.exports = { init, broadcast, broadcastAll, getActiveUserIds };
