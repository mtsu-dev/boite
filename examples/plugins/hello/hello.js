// @bun
// ../../../packages/plugin-sdk/src/socket.ts
import { createHash, randomBytes } from "crypto";
import { connect as tcpConnect } from "net";
import { connect as tlsConnect } from "tls";
var GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
var MAX_MESSAGE_BYTES = 64 << 20;
var MAX_HEAD_BYTES = 16 << 10;

class TextSocket {
  #socket;
  #open = true;
  #closed = false;
  #buffer = Buffer.alloc(0);
  #parts = [];
  #partBytes = 0;
  #fragmented = false;
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #events;
  constructor(socket, rest, events) {
    this.#socket = socket;
    this.#events = events;
    socket.on("data", (chunk) => this.#read(chunk));
    socket.on("close", () => this.#ended(1006, "the connection closed"));
    socket.on("error", (error) => this.#ended(1006, error.message));
    if (rest.length > 0)
      queueMicrotask(() => this.#read(rest));
  }
  get open() {
    return this.#open;
  }
  send(text) {
    if (!this.#open)
      throw new Error("the socket is closed");
    this.#socket.write(encodeFrame(1, Buffer.from(text, "utf8")));
  }
  close(code = 1000) {
    if (!this.#open)
      return;
    this.#open = false;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    this.#socket.write(encodeFrame(8, payload));
    setTimeout(() => this.#socket.destroy(), 1000).unref?.();
  }
  #ended(code, reason) {
    if (this.#closed)
      return;
    this.#closed = true;
    this.#open = false;
    this.#socket.destroy();
    this.#events.close(code, reason);
  }
  #fail(reason, code = 1002) {
    if (this.#open) {
      this.#open = false;
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code);
      this.#socket.write(encodeFrame(8, payload));
    }
    this.#ended(code, reason);
  }
  #read(chunk) {
    if (this.#closed)
      return;
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    for (;; ) {
      const frame = parseFrame(this.#buffer);
      if (frame === null)
        return;
      if ("error" in frame) {
        this.#fail(frame.error);
        return;
      }
      this.#buffer = this.#buffer.subarray(frame.size);
      this.#frame(frame.fin, frame.opcode, frame.payload);
      if (this.#closed)
        return;
    }
  }
  #frame(fin, opcode, payload) {
    switch (opcode) {
      case 0:
      case 1: {
        if (opcode === 0 !== this.#fragmented) {
          this.#fail(`opcode ${opcode} out of sequence`);
          return;
        }
        this.#partBytes += payload.length;
        if (this.#partBytes > MAX_MESSAGE_BYTES) {
          this.#fail(`a message over ${MAX_MESSAGE_BYTES} B`, 1009);
          return;
        }
        this.#parts.push(Buffer.from(payload));
        this.#fragmented = !fin;
        if (!fin)
          return;
        const whole = Buffer.concat(this.#parts);
        this.#parts = [];
        this.#partBytes = 0;
        let text;
        try {
          text = this.#decoder.decode(whole);
        } catch {
          this.#fail("a text message that is not UTF-8", 1007);
          return;
        }
        this.#events.message(text);
        return;
      }
      case 8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (this.#open) {
          this.#open = false;
          this.#socket.write(encodeFrame(8, payload.subarray(0, 2)));
        }
        this.#ended(code, payload.subarray(2).toString("utf8"));
        return;
      }
      case 9:
        if (this.#open)
          this.#socket.write(encodeFrame(10, payload));
        return;
      case 10:
        return;
      default:
        this.#fail(`opcode ${opcode}`);
    }
  }
  static connect(url, timeoutMs, events) {
    let target;
    try {
      target = new URL(url);
    } catch {
      return Promise.reject(new Error(`not a WebSocket URL: ${url}`));
    }
    if (target.protocol !== "ws:" && target.protocol !== "wss:") {
      return Promise.reject(new Error(`a WebSocket URL starts with ws:// or wss://, got ${target.protocol}`));
    }
    const secure = target.protocol === "wss:";
    const port = Number(target.port || (secure ? 443 : 80));
    const host = target.hostname.replace(/^\[(.*)\]$/, "$1");
    const key = randomBytes(16).toString("base64");
    const expected = createHash("sha1").update(key + GUID).digest("base64");
    return new Promise((resolve, reject) => {
      const socket = secure ? tlsConnect({ host, port, servername: host }) : tcpConnect({ host, port });
      let head = Buffer.alloc(0);
      let settled = false;
      const fail = (message) => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail(`timed out opening ${target.host}`), timeoutMs);
      socket.once(secure ? "secureConnect" : "connect", () => {
        socket.write([
          `GET ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join(`\r
`));
      });
      socket.on("error", (error) => fail(`could not reach ${target.host}: ${error.message}`));
      socket.on("close", () => fail(`${target.host} closed the connection before the upgrade`));
      const onData = (chunk) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf(`\r
\r
`);
        if (end < 0) {
          if (head.length > MAX_HEAD_BYTES)
            fail("the upgrade answer is too long");
          return;
        }
        const lines = head.subarray(0, end).toString("latin1").split(`\r
`);
        const status = lines[0] ?? "";
        if (!/^HTTP\/1\.1 101\b/.test(status)) {
          fail(`the core refused the upgrade: ${status}`);
          return;
        }
        const accept = lines.find((line) => /^sec-websocket-accept:/i.test(line))?.split(":")[1]?.trim();
        if (accept !== expected) {
          fail("the upgrade answer carries a wrong Sec-WebSocket-Accept");
          return;
        }
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        socket.off("data", onData);
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        resolve(new TextSocket(socket, head.subarray(end + 4), events));
      };
      socket.on("data", onData);
    });
  }
}
function parseFrame(bytes) {
  if (bytes.length < 2)
    return null;
  const first = bytes[0], second = bytes[1];
  if ((first & 112) !== 0)
    return { error: "reserved bits set with no extension negotiated" };
  if ((second & 128) !== 0)
    return { error: "the server masked a frame" };
  const fin = (first & 128) !== 0, opcode = first & 15;
  let length = second & 127, header = 2;
  if (length === 126) {
    if (bytes.length < 4)
      return null;
    length = bytes.readUInt16BE(2);
    header = 4;
  } else if (length === 127) {
    if (bytes.length < 10)
      return null;
    const big = bytes.readBigUInt64BE(2);
    if (big > BigInt(MAX_MESSAGE_BYTES))
      return { error: `a ${big} B frame` };
    length = Number(big);
    header = 10;
  }
  if (opcode >= 8 && (!fin || length > 125))
    return { error: `a fragmented or ${length} B control frame` };
  if (bytes.length < header + length)
    return null;
  return { fin, opcode, payload: bytes.subarray(header, header + length), size: header + length };
}
function encodeFrame(opcode, payload) {
  const n = payload.length;
  const header = n < 126 ? 2 : n < 65536 ? 4 : 10;
  const out = Buffer.alloc(header + 4 + n);
  out[0] = 128 | opcode;
  if (n < 126)
    out[1] = 128 | n;
  else if (n < 65536) {
    out[1] = 128 | 126;
    out.writeUInt16BE(n, 2);
  } else {
    out[1] = 128 | 127;
    out.writeBigUInt64BE(BigInt(n), 2);
  }
  const mask = randomBytes(4);
  mask.copy(out, header);
  for (let i = 0;i < n; i++)
    out[header + 4 + i] = payload[i] ^ mask[i & 3];
  return out;
}

// ../../../packages/plugin-sdk/src/connect.ts
var PROTOCOL_VERSION = 2;
var RPC_PATH = "/rpc";
var SDK_VERSION = "0.1.0";

class RpcError extends Error {
  code;
  data;
  constructor(message, code, data) {
    super(message);
    this.code = code;
    this.data = data;
    this.name = "RpcError";
  }
}
function socketUrl(base) {
  let url = base.trim().replace(/^http/, "ws");
  while (url.endsWith("/"))
    url = url.slice(0, -1);
  return url.endsWith(RPC_PATH) ? url : url + RPC_PATH;
}
async function connect(options = {}) {
  const env = options.env ?? process.env;
  const base = options.url ?? env.BOITE_CORE_URL;
  const token = options.token ?? env.BOITE_TOKEN;
  if (!base)
    throw new Error("BOITE_CORE_URL is not set: Boite sets it in a plugin's processes; pass `url` to connect from elsewhere");
  if (!token)
    throw new Error("BOITE_TOKEN is not set: Boite sets it in a plugin's processes; pass `token` to connect from elsewhere");
  const timeoutMs = options.timeoutMs ?? 5000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120000;
  const pending = new Map;
  const listeners = new Map;
  let nextId = 1;
  let onClosed;
  const closed = new Promise((resolve) => {
    onClosed = resolve;
  });
  const socket = await TextSocket.connect(socketUrl(base), timeoutMs, {
    message(text) {
      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (frame === null || typeof frame !== "object")
        return;
      if (typeof frame.id === "number") {
        const waiter = pending.get(frame.id);
        if (waiter === undefined)
          return;
        pending.delete(frame.id);
        clearTimeout(waiter.timer);
        if (frame.error !== undefined) {
          const { code, message, data } = frame.error;
          waiter.reject(new RpcError(typeof message === "string" ? message : `${waiter.method} failed`, typeof code === "number" ? code : 0, data));
        } else {
          waiter.resolve(frame.result);
        }
        return;
      }
      if (typeof frame.method !== "string")
        return;
      for (const handler of listeners.get(frame.method) ?? [])
        handler(frame.params);
    },
    close(code, reason) {
      const error = new Error(`the core closed the socket (${code}${reason ? `: ${reason}` : ""})`);
      for (const waiter of pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      pending.clear();
      onClosed({ code, reason });
    }
  });
  const send = (method, params, waitMs) => new Promise((resolve, reject) => {
    if (!socket.open) {
      reject(new Error("the client is closed"));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out waiting for ${method}`));
    }, waitMs);
    pending.set(id, { method, resolve, reject, timer });
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  let hello;
  try {
    hello = await send("hello", {
      token,
      protocolVersion: PROTOCOL_VERSION,
      client: { name: "plugin", version: options.version ?? SDK_VERSION }
    }, timeoutMs);
  } catch (error) {
    socket.close();
    throw error;
  }
  if (hello.core.protocolVersion !== PROTOCOL_VERSION) {
    socket.close();
    throw new Error(`the core speaks protocol ${String(hello.core.protocolVersion)}, this SDK ${PROTOCOL_VERSION}`);
  }
  return {
    core: hello.core,
    principal: hello.principal,
    closed,
    call: (method, params) => send(method, params, requestTimeoutMs),
    on(event, handler) {
      let set = listeners.get(event);
      if (set === undefined) {
        set = new Set;
        listeners.set(event, set);
      }
      const wrapped = (payload) => handler(payload);
      set.add(wrapped);
      return () => {
        set.delete(wrapped);
      };
    },
    close: () => socket.close()
  };
}
// ../../../packages/plugin-sdk/src/commands.ts
async function dispatch(handlers, options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? ((line) => {
    process.stderr.write(`${line}
`);
  });
  const [name, ...args] = argv;
  const service = options.service;
  const handler = name === undefined ? service === undefined ? undefined : (_args, ctx) => service(ctx) : Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (handler === undefined) {
    const known = Object.keys(handlers).sort();
    stderr(name === undefined ? "no command named" : `unknown command: ${name}`);
    stderr(`usage: boite <command> [args...], where <command> is ${known.length ? known.join(", ") : "none: this plugin declares no command"}`);
    return 2;
  }
  let client = null;
  const ctx = {
    name: name ?? "",
    cwd: options.cwd ?? process.cwd(),
    callerThreadId: env.BOITE_CALLER_THREAD_ID || null,
    pluginId: env.BOITE_PLUGIN_ID ?? "",
    dataDir: env.BOITE_PLUGIN_DATA ?? "",
    connect: () => client ??= connect({ ...options.connect, env })
  };
  try {
    const code = await handler(args, ctx);
    return typeof code === "number" ? code : 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (client !== null)
      await client.then((opened) => opened.close(), () => {});
  }
}
async function runCommands(handlers, options = {}) {
  const code = await dispatch(handlers, options);
  process.exit(code);
}
// src/main.ts
await runCommands({
  "hello-threads": async (args, ctx) => {
    const unknown = args.filter((arg) => arg !== "--json");
    if (unknown.length > 0) {
      console.error(`unknown argument: ${unknown[0]}; usage: boite hello-threads [--json]`);
      return 2;
    }
    const client = await ctx.connect();
    const threads = await client.call("threads.list", {});
    const latest = threads.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((thread) => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt }));
    if (args.includes("--json"))
      console.log(JSON.stringify(latest, null, 2));
    else
      for (const thread of latest)
        console.log(`${thread.title || "(untitled)"}  ${thread.id}`);
  }
});
