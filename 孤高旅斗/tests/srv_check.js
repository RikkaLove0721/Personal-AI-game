/* 孤高旅斗 · Python 服务器联机自检（HTTP + WebSocket + 房间 + 双向转发） */
const http = require("http");
const net = require("net");
const crypto = require("crypto");

const PORT = Number(process.argv[2] || 8302);
let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? (pass++, console.log("  ✔ " + m + (extra ? "  [" + extra + "]" : ""))) : (fail++, console.log("  ✘ " + m + (extra ? "  [" + extra + "]" : ""))); };

function get(path) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, r => {
      let b = ""; r.on("data", d => b += d); r.on("end", () => res({ code: r.statusCode, body: b }));
    }).on("error", rej);
  });
}

// ---- 极简 WebSocket 客户端 ----
function ws() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(PORT, "127.0.0.1", () => {
      sock.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = Buffer.alloc(0), open = false;
    const api = {
      send(o) { sock.write(frame(Buffer.from(JSON.stringify(o), "utf8"))); },
      close() { sock.destroy(); },
      onMsg: null,
      onClose: null,
    };
    sock.on("error", reject);
    sock.on("close", () => { if (api.onClose) api.onClose(); });
    sock.on("data", d => {
      buf = Buffer.concat([buf, d]);
      if (!open) {
        const i = buf.indexOf("\r\n\r\n");
        if (i < 0) return;
        const head = buf.slice(0, i).toString();
        if (!/101/.test(head)) return reject(new Error("握手失败: " + head.split("\r\n")[0]));
        buf = buf.slice(i + 4); open = true; resolve(api);   // 继续解析同一批次里剩余的数据帧
      }
      while (buf.length >= 2) {
        const b1 = buf[1], masked = b1 & 0x80;
        let len = b1 & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (masked) off += 4;
        if (buf.length < off + len) return;
        let pl = buf.slice(off, off + len);
        if (masked) { const m = buf.slice(off - 4, off); for (let i = 0; i < pl.length; i++) pl[i] ^= m[i & 3]; }
        buf = buf.slice(off + len);
        const op = buf.slice(0, 0);  // noop
        try { if (api.onMsg) api.onMsg(JSON.parse(pl.toString("utf8"))); } catch (e) {}
      }
    });
  });
}

function frame(payload) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  const out = Buffer.alloc(head.length + 4 + len);
  head.copy(out, 0); mask.copy(out, head.length);
  payload.copy(out, head.length + 4);
  for (let i = 0; i < len; i++) out[head.length + 4 + i] ^= mask[i & 3];
  return out;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (o, ev, ms) => new Promise(r => {
  const t = setTimeout(() => r(null), ms);
  const prev = o[ev];
  o[ev] = m => { clearTimeout(t); o[ev] = prev; r(m); };
});

(async () => {
  console.log("=== 孤高旅斗 · Python 服务器自检 (端口 " + PORT + ") ===\n");

  // 1. HTTP
  const r = await get("/");
  ok(r.code === 200, "根路径返回 200", "HTTP " + r.code);
  ok(r.body.includes("孤高旅斗"), "游戏 HTML 内容正确", r.body.length + " 字节");

  // 2. 建房
  const host = await ws();
  const hostMsgs = [];
  host.onMsg = m => hostMsgs.push(m);
  ok(true, "房主 WebSocket 握手成功");
  host.send({ t: "create" });
  const created = await once(host, "onMsg", 3000);
  const code = created && created.code;
  ok(!!code, "创建房间并下发房号", code);
  ok(created && created.t === "created", "消息类型为 created", created && created.t);

  // 3. 错误房号
  const bad = await ws();
  const badMsgs = []; bad.onMsg = m => badMsgs.push(m);
  bad.send({ t: "join", code: "ZZZZ" });
  await wait(400);
  ok(badMsgs.some(m => m.t === "err"), "错误房号返回 err");

  // 4. 正常加入
  const guest = await ws();
  const guestMsgs = []; guest.onMsg = m => guestMsgs.push(m);
  guest.send({ t: "join", code, name: "客机" });
  await wait(500);
  ok(guestMsgs.some(m => m.t === "joined"), "客机收到 joined");
  ok(hostMsgs.some(m => m.t === "peer" && m.d && m.d.t === "peerJoined"), "房主收到 peerJoined");

  // 5. 双向转发
  guest.send({ t: "m", d: { t: "i", key: "J", down: true, ts: 111 } });
  await wait(300);
  ok(hostMsgs.some(m => m.t === "m" && m.d && m.d.t === "i" && m.d.key === "J"), "客机输入 → 房主");
  host.send({ t: "m", d: { t: "s", n: 7, ts: 222 } });
  await wait(300);
  ok(guestMsgs.some(m => m.t === "m" && m.d && m.d.t === "s" && m.d.n === 7), "房主快照 → 客机");

  // 6. 压测
  const t0 = Date.now();
  for (let i = 0; i < 600; i++) host.send({ t: "m", d: { t: "s", n: i, ts: i } });
  await wait(1200);
  const snaps = guestMsgs.filter(m => m.t === "m" && m.d && m.d.t === "s").length;
  ok(snaps >= 590, "600 条快照吞吐", snaps + " 条 / " + (Date.now() - t0) + "ms");

  // 7. 断线通知
  guest.close();
  await wait(600);
  ok(hostMsgs.some(m => m.t === "peer" && m.d && m.d.t === "peerLeft"), "客机断线 → 房主收到 peerLeft");

  // ========== 8. 四人房间（3 位挑战者） ==========
  const h2 = await ws();
  const h2Msgs = []; h2.onMsg = m => h2Msgs.push(m);
  h2.send({ t: "create" });
  const created2 = await once(h2, "onMsg", 3000);
  const code2 = created2 && created2.code;
  ok(!!code2, "四人测试：房间已创建", code2);

  const gA = await ws(); const gAMsgs = []; gA.onMsg = m => gAMsgs.push(m);
  const gB = await ws(); const gBMsgs = []; gB.onMsg = m => gBMsgs.push(m);
  gA.send({ t: "join", code: code2 });
  await wait(400);
  const jA = gAMsgs.find(m => m.t === "joined");
  ok(jA && jA.seat === 1, "挑战者 A 分到 1 号位", jA && jA.seat);
  gB.send({ t: "join", code: code2 });
  await wait(400);
  const jB = gBMsgs.find(m => m.t === "joined");
  ok(jB && jB.seat === 2, "挑战者 B 分到 2 号位", jB && jB.seat);

  const gC3 = await ws(); const gC3Msgs = []; gC3.onMsg = m => gC3Msgs.push(m);
  gC3.send({ t: "join", code: code2 });
  await wait(400);
  const jC3 = gC3Msgs.find(m => m.t === "joined");
  ok(jC3 && jC3.seat === 3, "挑战者 C 分到 3 号位", jC3 && jC3.seat);

  const gC = await ws(); const gCMsgs = []; gC.onMsg = m => gCMsgs.push(m);
  gC.send({ t: "join", code: code2 });
  await wait(400);
  ok(gCMsgs.some(m => m.t === "err" && /满/.test(m.msg)), "第五人被拒（房间已满 4/4）");
  ok(h2Msgs.filter(m => m.t === "peer" && m.d && m.d.t === "peerJoined").length === 3, "房主收到 3 次 peerJoined");

  // 房主广播 → 三位挑战者都能收到
  h2.send({ t: "m", d: { t: "s", n: 99 } });
  await wait(300);
  ok(gAMsgs.some(m => m.t === "m" && m.d && m.d.t === "s" && m.d.n === 99), "快照广播 → 挑战者 A");
  ok(gBMsgs.some(m => m.t === "m" && m.d && m.d.t === "s" && m.d.n === 99), "快照广播 → 挑战者 B");
  ok(gC3Msgs.some(m => m.t === "m" && m.d && m.d.t === "s" && m.d.n === 99), "快照广播 → 挑战者 C（4 人席位）");

  // 两位挑战者的输入都汇聚到房主
  gA.send({ t: "m", d: { t: "i", side: 1, n: 1 } });
  gB.send({ t: "m", d: { t: "i", side: 2, n: 2 } });
  await wait(300);
  ok(h2Msgs.some(m => m.t === "m" && m.d && m.d.t === "i" && m.d.side === 1), "A 输入 → 房主（side=1）");
  ok(h2Msgs.some(m => m.t === "m" && m.d && m.d.t === "i" && m.d.side === 2), "B 输入 → 房主（side=2）");

  // 挑战者之间不直连：A 发的消息不会到 B
  gA.send({ t: "m", d: { t: "x", secret: 1 } });
  await wait(300);
  ok(!gBMsgs.some(m => m.d && m.d.t === "x"), "挑战者之间不互通（星型拓扑）");

  // A 掉线：腾出座位，房主和 B 收到通知，C 能顶上
  gA.close();
  await wait(500);
  ok(h2Msgs.some(m => m.t === "peer" && m.d && m.d.t === "peerLeft"), "A 断线 → 房主收到通知");
  const gD = await ws(); const gDMsgs = []; gD.onMsg = m => gDMsgs.push(m);
  gD.send({ t: "join", code: code2 });
  await wait(400);
  const jD = gDMsgs.find(m => m.t === "joined");
  ok(jD && jD.seat === 1, "空出的 1 号位可以补位", jD && jD.seat);

  h2.close(); gB.close(); gC.close(); gC3.close(); gD.close();

  console.log("\n=== 结果 ===\n通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("测试异常：" + e.message); process.exit(1); });
