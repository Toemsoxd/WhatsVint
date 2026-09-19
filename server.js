const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

let state = 'starting';
let qrDataUrl = null;
let lastError = null;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'whatsvint',
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  }
});

client.on('qr', async (qr) => {
  state = 'qr';
  lastError = null;
  try {
    qrDataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320
    });
  } catch (error) {
    lastError = error.message;
  }
});

client.on('authenticated', () => {
  state = 'authenticated';
  qrDataUrl = null;
});

client.on('ready', () => {
  state = 'ready';
  qrDataUrl = null;
  lastError = null;
  console.log('WhatsVint: WhatsApp Web is ready.');
});

client.on('auth_failure', (message) => {
  state = 'auth_failure';
  lastError = message;
  console.error('WhatsVint auth failure:', message);
});

client.on('disconnected', (reason) => {
  state = 'disconnected';
  console.log('WhatsVint disconnected:', reason);
});

client.on('message', (message) => {
  console.log('Incoming message:', message.from, message.body);
});

app.get('/api/status', async (req, res) => {
  let info = null;

  if (state === 'ready') {
    try {
      info = await client.info;
    } catch (_) {}
  }

  res.json({
    state,
    qr: qrDataUrl,
    error: lastError,
    user: info ? {
      pushname: info.pushname,
      wid: info.wid?._serialized || null
    } : null
  });
});

app.get('/api/chats', async (req, res) => {
  if (state !== 'ready') {
    return res.status(503).json({ error: 'WhatsApp is not ready.', state });
  }

  try {
    const chats = await client.getChats();
    res.json(chats.map(chat => ({
      id: chat.id._serialized,
      name: chat.name || chat.formattedTitle || chat.id.user,
      isGroup: Boolean(chat.isGroup),
      unreadCount: chat.unreadCount || 0,
      timestamp: chat.timestamp || null,
      lastMessage: chat.lastMessage ? {
        body: chat.lastMessage.body || '',
        fromMe: Boolean(chat.lastMessage.fromMe)
      } : null
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  if (state !== 'ready') {
    return res.status(503).json({ error: 'WhatsApp is not ready.', state });
  }

  try {
    const chat = await client.getChatById(req.params.chatId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const messages = await chat.fetchMessages({ limit });

    res.json(messages.map(message => ({
      id: message.id._serialized,
      body: message.body || '',
      fromMe: Boolean(message.fromMe),
      author: message.author || null,
      timestamp: message.timestamp || null,
      type: message.type
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chats/:chatId/messages', async (req, res) => {
  if (state !== 'ready') {
    return res.status(503).json({ error: 'WhatsApp is not ready.', state });
  }

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

  if (!body) {
    return res.status(400).json({ error: 'Message body is required.' });
  }

  try {
    const message = await client.sendMessage(req.params.chatId, body);
    res.json({
      ok: true,
      id: message.id._serialized,
      body: message.body || body
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    await client.logout();
    state = 'logged_out';
    qrDataUrl = null;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`WhatsVint listening on port ${PORT}`);
  client.initialize().catch((error) => {
    state = 'error';
    lastError = error.message;
    console.error('WhatsVint initialization failed:', error);
  });
});
