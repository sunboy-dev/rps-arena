// WebSocket client with auto-reconnect. On reconnect it re-claims the seat with the saved token.
const SESSION_KEY = 'rps-arena-session';

export const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(v));
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  },
};

export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.queue = [];
    this.retry = 0;
    this.connect();
  }

  get url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus?.('online');
      const s = session.get();
      if (s?.code && s?.token) ws.send(JSON.stringify({ t: 'rejoin', code: s.code, token: s.token }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.onStatus?.('offline');
      const delay = Math.min(8000, 600 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  send(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
    else this.queue.push(m);
  }
}
