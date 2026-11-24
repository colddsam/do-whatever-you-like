import type { MqttConfig, SocketIoConfig } from "../types";
import { b64ToBytes, bytesToB64, concatBytes, td, te } from "./util";

/**
 * Realtime clients that run straight from the browser (WebSockets aren't limited by CORS):
 * raw WebSocket, Socket.IO (Engine.IO v3/v4 over a WebSocket) and MQTT 3.1.1 / 5.0 over WebSocket.
 * Each reports everything as a list of messages for the message log.
 */

export type RtMessage = { id: string; at: number; dir: "in" | "out" | "sys"; text: string; event?: string; topic?: string; binary?: boolean; size: number; level?: "info" | "error" | "success" };

export type RtHooks = { onMessage: (m: Omit<RtMessage, "id">) => void; onState: (s: "connecting" | "open" | "closed") => void };

const sys = (text: string, level: RtMessage["level"] = "info"): Omit<RtMessage, "id"> => ({ at: Date.now(), dir: "sys", text, size: 0, level });

export interface RtClient {
  close(): void;
}

export function toWsUrl(url: string): string {
  const u = url.trim();
  if (/^wss?:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(u)) return `wss://${u.slice(8)}`;
  if (/^http:\/\//i.test(u)) return `ws://${u.slice(7)}`;
  return `${/^(localhost|127\.|\[::1\])/.test(u) ? "ws" : "wss"}://${u}`;
}

const closeReason = (e: CloseEvent) =>
  `Disconnected (code ${e.code}${e.reason ? `: ${e.reason}` : e.code === 1006 ? ": the connection dropped or was refused" : e.code === 1000 ? ": normal close" : ""})`;

/* ------------------------------------------------------------------ WebSocket */

export class WsClient implements RtClient {
  ws: WebSocket;
  constructor(url: string, protocols: string[], private hooks: RtHooks) {
    hooks.onState("connecting");
    hooks.onMessage(sys(`Connecting to ${url}${protocols.length ? ` (protocols: ${protocols.join(", ")})` : ""}`));
    this.ws = new WebSocket(toWsUrl(url), protocols.length ? protocols : undefined);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      hooks.onState("open");
      hooks.onMessage(sys(`Connected${this.ws.protocol ? ` (protocol ${this.ws.protocol})` : ""}`, "success"));
    };
    this.ws.onmessage = (e) => {
      if (typeof e.data === "string") hooks.onMessage({ at: Date.now(), dir: "in", text: e.data, size: te.encode(e.data).length });
      else {
        const b = new Uint8Array(e.data as ArrayBuffer);
        hooks.onMessage({ at: Date.now(), dir: "in", text: bytesToB64(b), binary: true, size: b.length });
      }
    };
    this.ws.onerror = () => hooks.onMessage(sys("Connection error. Check the URL (ws:// or wss://) and that the server accepts WebSocket connections.", "error"));
    this.ws.onclose = (e) => {
      hooks.onState("closed");
      hooks.onMessage(sys(closeReason(e), e.code === 1000 ? "info" : "error"));
    };
  }
  send(text: string, format: "text" | "json" | "binary") {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("Not connected.");
    if (format === "binary") {
      const bytes = /^[0-9a-f\s]+$/i.test(text.trim()) && text.replace(/\s/g, "").length % 2 === 0 ? Uint8Array.from(text.replace(/\s/g, "").match(/../g) ?? [], (h) => parseInt(h, 16)) : b64ToBytes(text.trim());
      this.ws.send(bytes);
      this.hooks.onMessage({ at: Date.now(), dir: "out", text: bytesToB64(bytes), binary: true, size: bytes.length });
    } else {
      this.ws.send(text);
      this.hooks.onMessage({ at: Date.now(), dir: "out", text, size: te.encode(text).length });
    }
  }
  close() {
    this.ws.close(1000, "Closed by user");
  }
}

/* ------------------------------------------------------------------ Socket.IO */

export class SocketIoClient implements RtClient {
  ws: WebSocket;
  private ackId = 0;
  private acks = new Map<number, string>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private ns: string;
  private eio: 3 | 4;
  constructor(url: string, private cfg: SocketIoConfig, private hooks: RtHooks) {
    this.eio = cfg.version === "v2" ? 3 : 4;
    this.ns = cfg.namespace && cfg.namespace !== "/" ? (cfg.namespace.startsWith("/") ? cfg.namespace : `/${cfg.namespace}`) : "/";
    const u = new URL(toWsUrl(url));
    // A namespace written in the URL (https://host/admin) is the namespace, not the path.
    if (u.pathname && u.pathname !== "/" && this.ns === "/") this.ns = u.pathname.replace(/\/$/, "");
    u.pathname = (cfg.path || "/socket.io").replace(/\/?$/, "/");
    u.searchParams.set("EIO", String(this.eio));
    u.searchParams.set("transport", "websocket");
    hooks.onState("connecting");
    hooks.onMessage(sys(`Connecting to ${u.origin}${u.pathname} (Socket.IO ${cfg.version}, namespace ${this.ns})`));
    this.ws = new WebSocket(u.toString());
    this.ws.onmessage = (e) => this.onPacket(String(e.data));
    this.ws.onerror = () => hooks.onMessage(sys("Connection error. Check the URL, the Socket.IO version and the handshake path.", "error"));
    this.ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      hooks.onState("closed");
      hooks.onMessage(sys(closeReason(e), e.code === 1000 ? "info" : "error"));
    };
  }
  private nsPrefix() {
    return this.ns === "/" ? "" : `${this.ns},`;
  }
  private onPacket(p: string) {
    const type = p[0];
    const rest = p.slice(1);
    if (type === "0") {
      const open = JSON.parse(rest || "{}");
      if (this.eio === 4 || this.ns !== "/") {
        let auth = "";
        if (this.cfg.auth?.trim() && this.eio === 4) {
          try {
            auth = JSON.stringify(JSON.parse(this.cfg.auth));
          } catch {
            this.hooks.onMessage(sys("The auth payload isn't valid JSON; connecting without it.", "error"));
          }
        }
        this.ws.send(`40${this.nsPrefix()}${auth}`);
      }
      if (this.eio === 3 && open.pingInterval) this.pingTimer = setInterval(() => this.ws.readyState === WebSocket.OPEN && this.ws.send("2"), open.pingInterval);
      return;
    }
    if (type === "2") {
      if (this.eio === 4) this.ws.send("3");
      return;
    }
    if (type === "3" || type === "6") return;
    if (type === "1") return;
    if (type !== "4") return;
    // Socket.IO packet: type, optional "/ns,", optional ack id, JSON.
    const sType = rest[0];
    let body = rest.slice(1);
    let ns = "/";
    if (body.startsWith("/")) {
      const c = body.indexOf(",");
      ns = c < 0 ? body : body.slice(0, c);
      body = c < 0 ? "" : body.slice(c + 1);
    }
    const idMatch = /^\d+/.exec(body);
    const id = idMatch ? Number(idMatch[0]) : undefined;
    if (idMatch) body = body.slice(idMatch[0].length);
    if (ns !== this.ns) return;
    if (sType === "0") {
      this.hooks.onState("open");
      this.hooks.onMessage(sys(`Connected to namespace ${this.ns}${body ? ` ${body}` : ""}`, "success"));
    } else if (sType === "4") this.hooks.onMessage(sys(`Connection refused by the server: ${body}`, "error"));
    else if (sType === "1") this.hooks.onMessage(sys("The server disconnected this namespace.", "error"));
    else if (sType === "2" || sType === "5") {
      let arr: unknown[] = [];
      try {
        arr = JSON.parse(body);
      } catch {
        arr = [body];
      }
      const [event, ...args] = arr as [string, ...unknown[]];
      const listening = this.cfg.listeners.some((l) => l.enabled && (l.event === event || l.event === "*"));
      if (!listening) return;
      const text = args.length === 1 ? (typeof args[0] === "string" ? args[0] : JSON.stringify(args[0], null, 2)) : JSON.stringify(args, null, 2);
      this.hooks.onMessage({ at: Date.now(), dir: "in", event, text, size: body.length });
      if (id !== undefined && this.cfg.ack) this.ws.send(`43${this.nsPrefix()}${id}[]`);
    } else if (sType === "3" || sType === "6") {
      const event = id !== undefined ? this.acks.get(id) : undefined;
      this.hooks.onMessage({ at: Date.now(), dir: "in", event: `ack${event ? ` · ${event}` : ""}`, text: body, size: body.length });
    }
  }
  emit(event: string, args: string[], ack: boolean) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("Not connected.");
    const values = args.map((a) => {
      try {
        return JSON.parse(a);
      } catch {
        return a;
      }
    });
    let id = "";
    if (ack) {
      this.ackId++;
      this.acks.set(this.ackId, event);
      id = String(this.ackId);
    }
    const payload = JSON.stringify([event, ...values]);
    this.ws.send(`42${this.nsPrefix()}${id}${payload}`);
    this.hooks.onMessage({ at: Date.now(), dir: "out", event, text: args.join("\n"), size: payload.length });
  }
  close() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(`41${this.nsPrefix()}`);
    this.ws.close(1000, "Closed by user");
  }
}

/* ------------------------------------------------------------------ MQTT */

const PKT = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, PUBREC: 5, PUBREL: 6, PUBCOMP: 7, SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const mstr = (s: string) => {
  const b = te.encode(s);
  return [...u16(b.length), ...b];
};
const mbytes = (b: Uint8Array) => [...u16(b.length), ...b];
const packet = (type: number, flags: number, body: number[]) => new Uint8Array([(type << 4) | flags, ...varint(body.length), ...body]);

const CONNACK_CODES: Record<number, string> = {
  1: "unacceptable protocol version",
  2: "client id rejected",
  3: "server unavailable",
  4: "bad user name or password",
  5: "not authorised",
  128: "unspecified error",
  130: "protocol error",
  133: "client id not valid",
  134: "bad user name or password",
  135: "not authorised",
  136: "server unavailable",
  140: "bad authentication method",
};

export class MqttClient implements RtClient {
  ws: WebSocket;
  private buf: Uint8Array = new Uint8Array();
  private pid = 0;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private v5: boolean;
  private pendingSubs = new Map<number, { topic: string; qos: number }[]>();
  constructor(url: string, private cfg: MqttConfig, private hooks: RtHooks) {
    this.v5 = cfg.version === "5.0";
    hooks.onState("connecting");
    const wsUrl = toWsUrl(url);
    hooks.onMessage(sys(`Connecting to ${wsUrl} (MQTT ${cfg.version} over WebSocket)`));
    this.ws = new WebSocket(wsUrl, ["mqtt"]);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.ws.send(this.connectPacket());
    this.ws.onmessage = (e) => {
      this.buf = concatBytes([this.buf, new Uint8Array(e.data as ArrayBuffer)]);
      this.drain();
    };
    this.ws.onerror = () => hooks.onMessage(sys("Connection error. MQTT in a browser needs the broker's WebSocket port (e.g. wss://broker.hivemq.com:8884/mqtt).", "error"));
    this.ws.onclose = (e) => {
      if (this.keepAlive) clearInterval(this.keepAlive);
      hooks.onState("closed");
      hooks.onMessage(sys(closeReason(e), e.code === 1000 ? "info" : "error"));
    };
  }
  private nextId() {
    this.pid = (this.pid % 65535) + 1;
    return this.pid;
  }
  private connectPacket() {
    const c = this.cfg;
    let flags = c.clean ? 0x02 : 0;
    if (c.username) flags |= 0x80;
    if (c.password) flags |= 0x40;
    const will = c.lastWill?.topic ? c.lastWill : undefined;
    if (will) flags |= 0x04 | (will.qos << 3) | (will.retain ? 0x20 : 0);
    const body = [...mstr("MQTT"), this.v5 ? 5 : 4, flags, ...u16(c.keepAlive), ...(this.v5 ? [0] : []), ...mstr(c.clientId || `dwyl-${Math.random().toString(16).slice(2, 10)}`)];
    if (will) body.push(...(this.v5 ? [0] : []), ...mstr(will.topic), ...mbytes(te.encode(will.payload)));
    if (c.username) body.push(...mstr(c.username));
    if (c.password) body.push(...mbytes(te.encode(c.password)));
    return packet(PKT.CONNECT, 0, body);
  }
  private drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const head = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(head >> 4, head & 0x0f, body);
    }
  }
  private skipProps(b: Uint8Array, at: number): number {
    if (!this.v5) return at;
    let mult = 1;
    let len = 0;
    let byte: number;
    do {
      byte = b[at++];
      len += (byte & 127) * mult;
      mult *= 128;
    } while (byte & 128);
    return at + len;
  }
  private handle(type: number, flags: number, b: Uint8Array) {
    if (type === PKT.CONNACK) {
      const code = b[1];
      if (code === 0) {
        this.hooks.onState("open");
        this.hooks.onMessage(sys(`Connected${b[0] & 1 ? " (session resumed)" : ""}`, "success"));
        if (this.cfg.keepAlive > 0) this.keepAlive = setInterval(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(packet(PKT.PINGREQ, 0, [])), this.cfg.keepAlive * 750);
        const subs = this.cfg.subscriptions.filter((s) => s.enabled && s.topic);
        if (subs.length) this.subscribe(subs.map((s) => ({ topic: s.topic, qos: s.qos })));
      } else {
        this.hooks.onMessage(sys(`The broker refused the connection: ${CONNACK_CODES[code] ?? `code ${code}`}.`, "error"));
        this.ws.close();
      }
    } else if (type === PKT.PUBLISH) {
      const qos = (flags >> 1) & 3;
      const tlen = (b[0] << 8) | b[1];
      const topic = td.decode(b.subarray(2, 2 + tlen));
      let at = 2 + tlen;
      let id = 0;
      if (qos > 0) {
        id = (b[at] << 8) | b[at + 1];
        at += 2;
      }
      at = this.skipProps(b, at);
      const payload = b.subarray(at);
      const text = td.decode(payload);
      const printable = !/[\u0000-\u0008\u000e-\u001f]/.test(text);
      this.hooks.onMessage({ at: Date.now(), dir: "in", topic: `${topic}${flags & 1 ? " · retained" : ""}${qos ? ` · QoS ${qos}` : ""}`, text: printable ? text : bytesToB64(payload), binary: !printable, size: payload.length });
      if (qos === 1) this.ws.send(packet(PKT.PUBACK, 0, u16(id)));
      if (qos === 2) this.ws.send(packet(PKT.PUBREC, 0, u16(id)));
    } else if (type === PKT.PUBREC) this.ws.send(packet(PKT.PUBREL, 2, [b[0], b[1]]));
    else if (type === PKT.PUBREL) this.ws.send(packet(PKT.PUBCOMP, 0, [b[0], b[1]]));
    else if (type === PKT.PUBACK || type === PKT.PUBCOMP) this.hooks.onMessage(sys(`Delivered (packet ${(b[0] << 8) | b[1]})`, "success"));
    else if (type === PKT.SUBACK) {
      const id = (b[0] << 8) | b[1];
      const at = this.skipProps(b, 2);
      const subs = this.pendingSubs.get(id) ?? [];
      this.pendingSubs.delete(id);
      Array.from(b.subarray(at)).forEach((code, i) => {
        const s = subs[i];
        if (code < 3) this.hooks.onMessage(sys(`Subscribed to ${s?.topic ?? "topic"} (QoS ${code})`, "success"));
        else this.hooks.onMessage(sys(`The broker refused the subscription to ${s?.topic ?? "a topic"} (code ${code}).`, "error"));
      });
    } else if (type === PKT.UNSUBACK) this.hooks.onMessage(sys("Unsubscribed"));
    else if (type === PKT.DISCONNECT) this.hooks.onMessage(sys(`The broker disconnected${b.length ? ` (reason ${b[0]})` : ""}.`, "error"));
  }
  subscribe(subs: { topic: string; qos: number }[]) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("Not connected.");
    const id = this.nextId();
    this.pendingSubs.set(id, subs);
    const body = [...u16(id), ...(this.v5 ? [0] : [])];
    for (const s of subs) body.push(...mstr(s.topic), s.qos);
    this.ws.send(packet(PKT.SUBSCRIBE, 2, body));
  }
  unsubscribe(topic: string) {
    const body = [...u16(this.nextId()), ...(this.v5 ? [0] : []), ...mstr(topic)];
    this.ws.send(packet(PKT.UNSUBSCRIBE, 2, body));
  }
  publish(topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error("Not connected.");
    if (!topic) throw new Error("Add a topic to publish to.");
    const bytes = te.encode(payload);
    const body = [...mstr(topic), ...(qos ? u16(this.nextId()) : []), ...(this.v5 ? [0] : []), ...bytes];
    this.ws.send(packet(PKT.PUBLISH, (qos << 1) | (retain ? 1 : 0), body));
    this.hooks.onMessage({ at: Date.now(), dir: "out", topic: `${topic}${retain ? " · retained" : ""}${qos ? ` · QoS ${qos}` : ""}`, text: payload, size: bytes.length });
  }
  close() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(packet(PKT.DISCONNECT, 0, this.v5 ? [0, 0] : []));
    this.ws.close(1000, "Closed by user");
  }
}
