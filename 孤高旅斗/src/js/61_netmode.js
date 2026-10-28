/* ============================================================
 *  61_netmode.js — v4.34 联机「世界状态」补全
 * ============================================================
 *  背景：60_net.js 的快照只带了 fighters / projs / zones / 地形血量，
 *  各模式自己那几个状态对象（山芋、情报箱、充电站、据点、椅子、岩浆……）
 *  从来只在房主进程里存在。于是客机看到的是：
 *    · 山芋模式：看不到山芋（本地那份永远停在「预警」）
 *    · 护送情报箱：箱子杵在地图正中不动
 *    · 停电夜战：看不到任何人的手电筒光锥
 *    · 躲猫猫：不知道自己已经变成鬼，也看不到搜查进度
 *    · 抢椅子 / 木头人 / 岩浆 / 弹幕 / 渡江 / 碰碰车：同理
 *  因为客机不跑 B.update（它是纯观众），这些状态必须有线送过来。
 *
 *  分两段：
 *    1. 各模式动态状态 —— 本文件 mo 字段，每帧随快照下发（都是小数组）
 *    2. 运行期新增的「道具」 —— px 字段。据点炮塔 / 椅子 / 船 / 土墙 /
 *       补给箱这些都是中途 push 进 terrain.props 的，客机根本没有；
 *       一旦两端数组长度不同，60_net 那套按索引对齐的 tm 会整体错位。
 *       这里用「道具签名」判断：签名变了才整段重发（几十条，不是每帧）。
 *
 *  设计原则：客机只用来**看**。所有数值最终以房主为准，
 *  apply 只写进本地状态对象，不触发结算、不发事件、不改胜负。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle;

  const NM = LD.NetMode = {};

  /* ---------- 小工具 ---------- */
  const sideOf = f => (f && f.side != null ? f.side : -1);
  const bySide = s => (s != null && s >= 0 ? (B.fighters.find(f => f.side === s) || null) : null);
  const r2 = v => Math.round((v || 0) * 100) / 100;

  /** 对象 → 索引（模式状态里指向道具的字段用它压成数字） */
  function propIdx(o) {
    const list = B.terrain && B.terrain.props;
    return o && list ? list.indexOf(o) : -1;
  }

  /* ==========================================================
   *  一、各模式动态状态
   * ========================================================== */

  /* 每个规则一个 pack（房主）/ 一个 apply（客机）。
   * 键名用规则 id，长度都很短——局域网带宽不是瓶颈，可读性优先。 */
  const RULES = {};

  /* ---------- 烫手山芋 ---------- */
  RULES.hotpotato = {
    pack() {
      const p = B.potato;
      if (!p) return null;
      return [p.phase, r2(p.t), r2(p.fuse), p.round | 0, Math.round(p.x), Math.round(p.y),
        r2(p.holdT), r2(p.passLockT), r2(p.boomT), sideOf(p.tgt), sideOf(p.holder)];
    },
    apply(d) {
      if (!d) return;
      const p = B.potato || (B.potato = {});
      p.phase = d[0]; p.t = d[1]; p.fuse = d[2]; p.round = d[3];
      p.x = d[4]; p.y = d[5];
      p.holdT = d[6]; p.passLockT = d[7]; p.boomT = d[8];
      p.tgt = bySide(d[9]);
      p.holder = bySide(d[10]);
    }
  };

  /* ---------- 停电夜战 ---------- */
  RULES.blackout = {
    pack() {
      /* 手电筒 / 电量 / 黑暗条在 packFighter 里（每人都要看）；
       * 这里只补充电站位置（布局理论上同种子一致，发一份便宜的保险） */
      return (B.stations || []).map(s => [Math.round(s.x), Math.round(s.y)]);
    },
    apply(d) {
      if (!d) return;
      if (!B.stations) B.stations = [];
      d.forEach((a, i) => {
        const s = B.stations[i];
        if (s) { s.x = a[0]; s.y = a[1]; }
        else B.stations[i] = { x: a[0], y: a[1], t: 0 };
      });
    }
  };

  /* ---------- 护送情报箱 ---------- */
  RULES.escort = {
    pack() {
      const st = B.escort;
      if (!st) return null;
      const b = st.box || {};
      return [st.score[0] || 0, st.score[1] || 0, b.alive ? 1 : 0, Math.round(b.x || 0), Math.round(b.y || 0),
        sideOf(b.pusher), r2(st.respawnT), r2(st.dropT), st.done ? 1 : 0];
    },
    apply(d) {
      if (!d) return;
      const st = B.escort || (B.escort = { score: [0, 0], box: { x: 0, y: 0, alive: true, pusher: null }, respawnT: 0, dropT: 0, done: false });
      st.score = [d[0], d[1]];
      const b = st.box || (st.box = {});
      b.alive = !!d[2]; b.x = d[3]; b.y = d[4];
      b.pusher = bySide(d[5]);
      st.respawnT = d[6]; st.dropT = d[7]; st.done = !!d[8];
      /* 客机不跑 updateEscort，推箱者的 f.pushBox 也得自己挂上（绘制用它画引导线） */
      B.fighters.forEach(f => { if (f.pushBox && f.pushBox !== b) f.pushBox = null; });
      if (b.pusher) b.pusher.pushBox = b;
    }
  };

  /* ---------- 占点争夺 ---------- */
  RULES.capture = {
    pack() {
      const st = B.capture;
      if (!st) return null;
      return [st.score[0] || 0, st.score[1] || 0, st.done ? 1 : 0,
        st.pts.map(p => [Math.round(p.x), Math.round(p.y), Math.round(p.r), p.owner, r2(p.prog), p.by, p.c0 || 0, p.c1 || 0])];
    },
    apply(d) {
      if (!d) return;
      const st = B.capture || (B.capture = { score: [0, 0], acc: 0, done: false, pts: [] });
      st.score = [d[0], d[1]]; st.done = !!d[2];
      const list = d[3] || [];
      list.forEach((a, i) => {
        let p = st.pts[i];
        if (!p) p = st.pts[i] = { i: i, big: i === 0, name: i === 0 ? "B" : "P" + i, w: i === 0 ? 2 : 1, turret: null };
        p.x = a[0]; p.y = a[1]; p.r = a[2]; p.owner = a[3]; p.prog = a[4]; p.by = a[5]; p.c0 = a[6]; p.c1 = a[7];
      });
      if (st.pts.length > list.length) st.pts.length = list.length;
    }
  };

  /* ---------- 塔防对战 ---------- */
  RULES.tower = {
    pack() {
      if (!B.tScore) return null;
      const hero = B.fighters.filter(f => f.kind === "hero");
      return [B.tScore[0] || 0, B.tScore[1] || 0, r2(B.waveT), B.waveN || 0,
        (B.towerKills || [0, 0]).slice(), B.towerDone ? 1 : 0, B.towerResult || "",
        hero.map(f => [sideOf(f), f.level || 1, f.xp || 0, Math.round(f.bcoins || 0)]),
        /* v4.35 墓碑：塔防阵亡会在地上留一块墓碑（显示复活倒计时），
         * 客机的 B.graves 一直是 undefined，于是「队友死在哪儿」完全看不到 */
        (B.graves || []).map(g => [Math.round(g.x), Math.round(g.y), g.side, r2(g.born)])];
    },
    apply(d) {
      if (!d) return;
      B.tScore = [d[0], d[1]];
      B.waveT = d[2]; B.waveN = d[3];
      B.towerKills = d[4] || [0, 0];
      B.towerDone = !!d[5]; B.towerResult = d[6] || "";
      (d[7] || []).forEach(a => {
        const f = bySide(a[0]);
        if (!f) return;
        f.level = a[1]; f.xp = a[2]; f.bcoins = a[3];
      });
      if (d[8]) {
        B.graves = B.graves || [];
        B.graves.length = 0;
        d[8].forEach(a => B.graves.push({ x: a[0], y: a[1], side: a[2], born: a[3], hero: bySide(a[2]) }));
      }
    }
  };

  /* ---------- 躲猫猫 ---------- */
  RULES.hide = {
    pack() {
      const st = B.hide;
      if (!st) return null;
      const s = st.search;
      const rl = st.relic;
      return [st.caught || 0, r2(st.hintT), r2(st.relicT), st.searchMulT > 0 ? 1 : 0,
        rl ? 1 : 0, rl ? Math.round(rl.x) : 0, rl ? Math.round(rl.y) : 0,
        st.mark ? st.mark.side : -1, st.mark ? r2(st.mark.t) : 0,
        s ? sideOf(s.who) : -1, s ? propIdx(s.prop) : -1, s ? r2(s.t) : 0];
    },
    apply(d) {
      if (!d) return;
      const st = B.hide || (B.hide = { search: null, caught: 0, mark: null, relic: null, relicT: 0, searchMulT: 0, hintT: 0 });
      st.caught = d[0]; st.hintT = d[1]; st.relicT = d[2];
      st.searchMulT = d[3] ? 1 : 0;
      if (d[4]) {
        st.relic = st.relic || { t: 0, bob: 0, taken: false };
        st.relic.x = d[5]; st.relic.y = d[6]; st.relic.taken = false;
      } else st.relic = null;
      st.mark = d[7] >= 0 ? { side: d[7], t: d[8] } : null;
      const who = bySide(d[9]), prop = d[10] >= 0 ? (B.terrain && B.terrain.props[d[10]]) : null;
      st.search = (who && prop) ? { who: who, prop: prop, t: d[11] } : null;
    }
  };

  /* ---------- 抢椅子 ---------- */
  RULES.chair = {
    pack() {
      const st = B.chair;
      if (!st) return null;
      return [st.phase, r2(st.t), st.round || 0, st.n || 0,
        (st.seats || []).map(s => [Math.round(s.x), Math.round(s.y), Math.round(s.r || 62),
          s.fake ? 1 : 0, s.broken ? 1 : 0, sideOf(s.taken)])];
    },
    apply(d) {
      if (!d) return;
      const st = B.chair || (B.chair = { seats: [], phase: "hint", t: 0, round: 0, n: 0 });
      st.phase = d[0]; st.t = d[1]; st.round = d[2]; st.n = d[3];
      st.seats = (d[4] || []).map(a => ({
        x: a[0], y: a[1], r: a[2], fake: !!a[3], broken: !!a[4], taken: bySide(a[5]), t: 0
      }));
    }
  };

  /* ---------- 一二三木头人 ---------- */
  RULES.statue = {
    pack() {
      const st = B.statue;
      if (!st) return null;
      return [st.phase, r2(st.t), st.round || 0, r2(st.packT), st.hitCount || 0,
        (st.packs || []).map(p => [Math.round(p.x), Math.round(p.y), r2(p.bob || 0)]),
        (st.beams || []).map(b => [Math.round(b.x), Math.round(b.y), r2(b.t)])];
    },
    apply(d) {
      if (!d) return;
      const st = B.statue || (B.statue = { packs: [], beams: [], phase: "idle", t: 0, packT: 0, round: 0, hitCount: 0 });
      st.phase = d[0]; st.t = d[1]; st.round = d[2]; st.packT = d[3]; st.hitCount = d[4];
      st.packs = (d[5] || []).map(a => ({ x: a[0], y: a[1], bob: a[2], t: 0 }));
      st.beams = (d[6] || []).map(a => ({ x: a[0], y: a[1], t: a[2] }));
    }
  };

  /* ---------- 地板是岩浆 ---------- */
  RULES.lava = {
    pack() {
      const st = B.lava;
      if (!st) return null;
      const keys = set => (set ? Object.keys(set).map(Number) : null);
      return [st.phase, r2(st.t), st.round || 0, r2(st.ratio), st.nSafe != null ? st.nSafe : null,
        keys(st.hot), keys(st.warn)];
    },
    apply(d) {
      if (!d) return;
      const st = B.lava || (B.lava = { phase: "calm", t: 0, round: 0, ratio: 0, hot: null, warn: null });
      st.phase = d[0]; st.t = d[1]; st.round = d[2]; st.ratio = d[3]; st.nSafe = d[4];
      const toSet = arr => {
        if (!arr) return null;
        const o = {};
        for (let i = 0; i < arr.length; i++) o[arr[i]] = 1;
        return o;
      };
      st.hot = toSet(d[5]); st.warn = toSet(d[6]);
    }
  };

  /* ---------- 弹幕生存 ---------- */
  RULES.barrage = {
    pack() {
      const st = B.barrage;
      if (!st) return null;
      return [st.mode, r2(st.modeT), r2(st.gap), r2(st.flash),
        (st.turrets || []).map(t => [Math.round(t.x), Math.round(t.y), r2(t.cd), r2(t.phase), t.k || 0]),
        /* 弹幕本体不走 B.projs（它自己有独立数组），必须一并送过去，否则客机看不见子弹 */
        (st.bullets || []).map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.vx || 0),
          Math.round(b.vy || 0), Math.round(b.r || 6)])];
    },
    apply(d) {
      if (!d) return;
      const st = B.barrage || (B.barrage = { turrets: [], bullets: [], mode: "sweep", modeT: 0, gap: 0, flash: 0 });
      st.mode = d[0]; st.modeT = d[1]; st.gap = d[2]; st.flash = d[3];
      st.turrets = (d[4] || []).map(a => ({ x: a[0], y: a[1], cd: a[2], phase: a[3], k: a[4] }));
      st.bullets = (d[5] || []).map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4] }));
    }
  };

  /* ---------- 渡江战役 ---------- */
  RULES.river = {
    pack() {
      const st = B.river;
      if (!st) return null;
      return [r2(st.rise), r2(st.riseT), r2(st.shipT), r2(st.refreshT), st.batch || 0,
        (st.drums || []).map(d => [Math.round(d.x), Math.round(d.y), r2(d.t || 0)]),
        st.flag ? [Math.round(st.flag.x), Math.round(st.flag.y)] : null];
    },
    apply(d) {
      if (!d) return;
      const st = B.river || (B.river = { drums: [], flag: null, rise: 0, riseT: 0, shipT: 0, refreshT: 0 });
      st.rise = d[0]; st.riseT = d[1]; st.shipT = d[2]; st.refreshT = d[3]; st.batch = d[4];
      st.drums = (d[5] || []).map(a => ({ x: a[0], y: a[1], t: a[2] }));
      if (d[6]) st.flag = { x: d[6][0], y: d[6][1], r: (st.flag && st.flag.r) || 62 };
    }
  };

  /* ---------- 碰碰车竞技 ---------- */
  RULES.bump = {
    pack() {
      const st = B.bump;
      if (!st) return null;
      return [(st.score || []).slice(), st.done ? 1 : 0];
    },
    apply(d) {
      if (!d) return;
      const st = B.bump || (B.bump = { score: [], cd: {}, done: false, cars: [] });
      st.score = d[0] || [];
      st.done = !!d[1];
    }
  };

  /* ---------- 缩圈乱斗 ---------- */
  RULES.ring = {
    pack() {
      if (!B.rings) return null;
      return [r2(B.ringT), B.rings.map(c => [Math.round(c.x), Math.round(c.y), Math.round(c.r), c.dead ? 1 : 0])];
    },
    apply(d) {
      if (!d) return;
      B.ringT = d[0];
      B.rings = (d[1] || []).map(a => ({ x: a[0], y: a[1], r: a[2], r0: a[2], dead: !!a[3] }));
    }
  };

  /* ---------- 追猎时刻 ---------- */
  RULES.hunt = {
    pack() {
      const h = B.huntRing;
      return [B.hunterSide == null ? -1 : B.hunterSide,
        h ? Math.round(h.x) : 0, h ? Math.round(h.y) : 0, h ? Math.round(h.r) : 0];
    },
    apply(d) {
      if (!d) return;
      B.hunterSide = d[0];
      if (d[3]) {
        const h = B.huntRing || (B.huntRing = { tick: 0 });
        h.x = d[1]; h.y = d[2]; h.r = d[3];
      }
    }
  };

  /* ---------- 霸主争霸 ---------- */
  RULES.overlord = {
    pack() {
      const c = B.crown;
      if (!c) return null;
      return [c.phase, Math.round(c.x), Math.round(c.y), r2(c.warnT), r2(c.landT), sideOf(c.holder)];
    },
    apply(d) {
      if (!d) return;
      const c = B.crown || (B.crown = {});
      c.phase = d[0]; c.x = d[1]; c.y = d[2]; c.warnT = d[3]; c.landT = d[4];
      c.holder = bySide(d[5]);
    }
  };

  /* ==========================================================
   *  二、运行期新增的道具（px）
   * ==========================================================
   *  地形布局本身靠同种子两端一致（见 14_rand.js），这里只补「中途才出现」的：
   *  据点炮塔、抢椅子的椅子（不是道具，另有 mo）、渡江的船、土墙、补给箱……
   *
   *  为什么用「签名 + 整段重发」而不是逐条增量：
   *  船每 30 秒整批换新（先删后加），逐条增量要处理删除、顺序、ID 复用；
   *  而这一段的道具总共也就几十个，签名一变就整段重发最省心，且签名
   *  用 uid 求和，删一个加一个同帧发生也能察觉（长度相同的坑）。
   * ========================================================== */

  /** 道具 → 可 JSON 的描述（只留渲染用得上的标量；引用压成 side / 下标） */
  function packProp(o) {
    const out = {};
    for (const k in o) {
      if (k.charAt(0) === "_") continue;
      const v = o[k];
      const t = typeof v;
      if (t === "number" || t === "string" || t === "boolean") out[k] = v;
    }
    out.driver = o.driver ? o.driver.side : -1;
    out.occupant = o.occupant ? o.occupant.side : -1;
    /* 据点炮塔要挂回它服务的那个点，客机才能画「炮塔转属」并且 captureTurretOf 找得到 */
    if (o.pt && B.capture && B.capture.pts) out.pt = B.capture.pts.indexOf(o.pt);
    return out;
  }

  NM.propBase = function () { return B.propBase || 0; };

  /** 当前道具集合的签名（base 之后的那些） */
  NM.propSig = function () {
    const list = B.terrain && B.terrain.props;
    if (!list) return 0;
    const base = B.propBase || 0;
    let s = list.length * 1000003;
    for (let i = base; i < list.length; i++) {
      const u = list[i].uid || 0;
      s = (s + Math.imul(u | 0, i + 1)) | 0;
    }
    return s;
  };

  /* ==========================================================
   *  三、对外：打包 / 应用
   * ========================================================== */
  let lastSig = null;

  NM.pack = function () {
    const r = B.rule;
    const out = {};
    const def = RULES[r];
    if (def) {
      const d = def.pack();
      if (d != null) out[r] = d;
    }
    /* 道具签名变化时才带整段描述 */
    const sig = NM.propSig();
    out.g = sig;
    if (sig !== lastSig) {
      lastSig = sig;
      const list = (B.terrain && B.terrain.props) || [];
      out.p = list.slice(B.propBase || 0).map(packProp);
    }
    return out;
  };

  NM.apply = function (m) {
    if (!m) return;
    /* 道具：结构先对齐，后面 tm 那套按索引写血量才不会错位 */
    if (m.p && B.terrain && B.terrain.props) {
      const base = B.propBase || 0;
      B.terrain.props.length = base;
      m.p.forEach(d => {
        const o = Object.assign({}, d);
        o.driver = null; o.occupant = null;
        if (typeof d.pt === "number" && d.pt >= 0) {
          o.pt = B.capture && B.capture.pts ? B.capture.pts[d.pt] : null;
          if (o.pt) o.pt.turret = o;
        }
        B.terrain.props.push(o);
      });
      /* 引用回填：车的司机 / 柜子里的人 */
      for (let i = base; i < B.terrain.props.length; i++) {
        const o = B.terrain.props[i], d = m.p[i - base];
        if (d && d.driver >= 0) o.driver = bySide(d.driver);
        if (d && d.occupant >= 0) o.occupant = bySide(d.occupant);
      }
    }
    const def = RULES[B.rule];
    if (def && m[B.rule] != null) def.apply(m[B.rule]);
  };

  /* 房主换规则重开时把签名清掉（道具数组整体换了一份） */
  NM.reset = function () { lastSig = null; };
})(window.LD = window.LD || {});
