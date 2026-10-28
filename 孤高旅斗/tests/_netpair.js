/* 孤高旅斗 · 联机双端测试台（v4.34）
 *
 * 目的：以前所有测试都只跑「单机」，联机那条线只能靠肉身开两台电脑试。
 * 客机缺山芋 / 缺手电筒 / 情报箱不动这类问题，本质都是「房主状态没送到客机」，
 * 而这完全可以在一个进程里复现：两个沙箱各自加载一份 game.js，
 * 中间接一根内存里的网线，跑真实的 send / handle / snapshot 流程。
 *
 * 用法：
 *   const P = require("./_netpair.js");
 *   const p = P.makePair({ rule: "hotpotato", fighters: 3 });
 *   p.frame(60 * 3);                       // 跑 3 秒
 *   p.host.LD.Battle.potato                 // 房主状态
 *   p.client.LD.Battle.potato               // 客机状态（应当被同步过来）
 *   p.clientOf("potato")                    // 简写
 *
 * 注意：这是进程内直连，没有网络延迟 / 丢包，所以它验的是**协议覆盖度**，
 * 不是手感。丢包重传之类的仍要真机验证。
 */
const SB = require("./_sandbox.js");

const BASE_LOADOUT = { basic: "slash", skill1: "dashSlash", skill2: "blink", ult: "n_ult" };

function makePair(opt) {
  const o = opt || {};
  const rule = o.rule || "brawl";
  const n = o.fighters || 2;
  const seed = o.seed || 123456789;
  const withBots = o.bots !== false;

  const host = SB.makeSandbox("net-host-" + rule);
  const cli = SB.makeSandbox("net-client-" + rule);
  const HB = host.LD, CB = cli.LD;

  /* ---------------- 内存网线 ---------------- */
  const toClient = [], toHost = [];
  let bytes = 0;                     // 粗算同步带宽，便于发现「一帧发了几百 KB」

  HB.Net.toPeer = d => { toClient.push(d); bytes += JSON.stringify(d).length; };
  CB.Net.toPeer = d => { toHost.push(d); };
  HB.Net.send = HB.Net.toPeer;
  CB.Net.send = CB.Net.toPeer;

  /* 房主←→客机的连接状态：快照广播与事件广播都要看这两个字段 */
  HB.Net.isHost = true; HB.Net.mySide = 0; HB.Net.ok = true;
  HB.Net.peerIn = true; HB.Net.peersIn = [1];
  CB.Net.isHost = false; CB.Net.mySide = 1; CB.Net.ok = true;
  CB.Net.peerIn = true; CB.Net.peersIn = [0];

  /* 客机的 UI.enterGame 会去摸画布 / 图层，本测试只看战斗状态，直接短路 */
  try { CB.UI.enterGame = () => {}; HB.UI.enterGame = () => {}; } catch (e) {}

  /* ---------------- 组装花名册 ---------------- */
  const roster = [];
  for (let i = 0; i < n; i++) {
    const asBot = withBots && i > 0;
    roster.push({
      look: null,                        // 由 mkHero 自己取默认外观
      loadout: Object.assign({}, BASE_LOADOUT),
      name: i === 0 ? "房主" : (asBot ? "人机 " + i : "玩家 " + (i + 1)),
      team: -1,
      bot: asBot, level: "normal"
    });
  }

  const mods = o.mods || [];
  const matchT = o.matchT || 180;
  const mapCfg = HB.mapCfg({ preset: "arena", seed: 20260101, ground: "stone" });

  /* ---------------- 开局：走真实的 go 消息 ---------------- */
  const goMsg = { t: "go", roster: roster, rule: rule, dragonDiff: "normal", mods: mods, matchT: matchT, mapCfg: mapCfg, seed: seed };
  /* 先把客机接到「已加入房间」的状态 */
  CB.Net.fromPeer = CB.Net.fromPeer.bind(CB.Net);

  /* 客机收 go：和真实链路一样经过 handle → fromPeer → emit("start") → UI.startNetBattle */
  const origEnter = CB.UI.enterGame;
  CB.UI.enterGame = () => {};
  CB.Net.handle({ t: "m", d: goMsg });
  CB.UI.enterGame = origEnter;

  /* 房主本地开局（netHostStart 的最后一步） */
  HB.UI.enterGame = () => {};
  HB.UI.startNetBattle(roster, rule, "normal", mods, matchT, mapCfg, seed);

  /* ---------------- 推进 ---------------- */
  const HP = host.LD.Battle, CP = cli.LD.Battle;
  const drawCtx = SB.makeCtx();
  let t = 0, snapAcc = 0;

  const api = {
    host, client: cli,
    HB, CB, HP, CP,
    roster, rule, seed,
    bytes: () => bytes,
    /** 跑 dt 秒（默认 1/60 一帧） */
    frame(sec, hooks) {
      const dt = o.dt || 1 / 60;
      const steps = Math.max(1, Math.round(sec / dt));
      for (let i = 0; i < steps; i++) {
        t += dt;
        /* 房主：AI → 发快照 → 推进世界 */
        HP.fighters.forEach(f => {
          if (f.bench) return;
          if (f.kind === "hero" && f.bot) HB.AI.tickHero(f, dt);
          else if (f.kind === "dragon") HB.AI.tickDragon(f, dt);
        });
        snapAcc += dt;
        if (snapAcc >= HB.Net.snapInt) {
          snapAcc = 0;
          const snap = HB.Net.snapshot();
          /* 测试要「按房主发包那一刻的状态」去校验客机，否则房主总比客机多跑一帧，
           * 计时器差 0.02、坐标差 2px 这类假 diff 会淹掉真问题 */
          if (o.onSnap) { try { o.onSnap(api, snap); } catch (e) {} }
          HB.Net.toPeer(snap);
        }
        HB.Net.flushEvents();
        HP.update(dt);

        /* 客机：收快照 → 自己那一帧的平滑 / 特效 */
        while (toClient.length) CB.Net.handle({ t: "m", d: toClient.shift() });
        while (toHost.length) HB.Net.handle({ t: "m", d: toHost.shift() });
        CP.update(dt);

        /* 默认每帧真的画一遍：客机缺字段时最常见的表现就是绘制层抛异常 / 画不出来，
         * 只挪逻辑不画的话，一堆「看不见」的问题测不出来 */
        if (o.draw !== false) {
          try { HP.draw(drawCtx); } catch (e) { if (!api.hostDrawErr) api.hostDrawErr = e; }
          try { CP.draw(drawCtx); } catch (e) { if (!api.cliDrawErr) api.cliDrawErr = e; }
        }
        if (hooks) hooks(api, i);
      }
      return api;
    },
    /** 跑 n 帧 */
    frames(count, hooks) { return api.frame(count / 60, hooks); },
    /** 客机上的某个模式状态（简写，省得每处写 p.client.LD.Battle.xxx） */
    clientOf(k) { return CP[k]; },
    hostOf(k) { return HP[k]; }
  };
  return api;
}

module.exports = { makePair, BASE_LOADOUT };
