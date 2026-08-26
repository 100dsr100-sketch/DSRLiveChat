// Relays chat messages between the two devices in a pairing. Uses the
// WebSocket Hibernation API so the Durable Object doesn't rack up active
// duration while the connection just sits idle between messages - it only
// wakes to handle a message or a close event.
export class ChatRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);

    // Replay the last known language config so a device that connects after
    // the other side already picked a language doesn't have to wait for it
    // to change again before it hears about the setting.
    const config = await this.state.storage.get('config');
    if (config) {
      try { server.send(JSON.stringify(config)); } catch (err) { /* client not ready yet, ignore */ }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Fan the message out to every other connected socket in this room
  // (there are only ever up to two - the two paired devices).
  async webSocketMessage(ws, message) {
    try {
      const parsed = JSON.parse(message);
      if (parsed && parsed.type === 'config') {
        await this.state.storage.put('config', parsed);
      }
    } catch (err) { /* not JSON, just relay it as-is */ }

    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      try { other.send(message); } catch (err) { /* peer gone, ignore */ }
    }
  }

  webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch (err) { /* already closed */ }
  }

  webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch (err) { /* already closed */ }
  }
}

const CHAT_ROOM_NAME = 'dsr-livechat-default-room';

// Cloudflare Workers AI's whisper-large-v3-turbo wants the raw audio bytes
// as a base64 string, not a byte array - btoa() only accepts a "binary
// string" (one char per byte), so build that up in chunks to avoid blowing
// the call stack on String.fromCharCode.apply for larger recordings.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handleTranscribe(request, env, url) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  try {
    const lang = url.searchParams.get('lang') || undefined;
    const arrayBuffer = await request.arrayBuffer();
    const input = { audio: arrayBufferToBase64(arrayBuffer) };
    if (lang) input.language = lang;
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', input);
    return new Response(JSON.stringify({ text: result.text || '' }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err && err.message) || String(err) }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const id = env.CHAT_ROOM.idFromName(CHAT_ROOM_NAME);
      return env.CHAT_ROOM.get(id).fetch(request);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (url.pathname === '/transcribe') {
      return handleTranscribe(request, env, url);
    }

    const text = url.searchParams.get('text') || '';
    const itc = url.searchParams.get('itc') || 'hi-t-i0-und';
    const upstream = 'https://inputtools.google.com/request?text=' + encodeURIComponent(text) +
      '&itc=' + encodeURIComponent(itc) + '&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8';

    const resp = await fetch(upstream);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
