/* ============================================================
 *  49_zombiehouse.js — v4.9 僵尸守房
 * ============================================================
 *  全员同队守一栋房子,僵尸分波从场边涌来拆房:
 *    - 僵尸默认直奔房子,只有玩家拦在近处才先咬人(AI 分支见 50_ai.js)
 *    - 僵尸进房子判定圈后按间隔啃房,房子耐久归零即全军覆没
 *    - 一波清空后进入喘息期,站在房子里每秒修复耐久
 *    - 撑过全部波次后按击杀数排名,击杀最多者获胜
 *
 *  实现要点:
 *    - 僵尸复用 B.mkZombie(team 8,与所有人敌对),本模块自建波次调度,
 *      不接入 B.updateZombies(它只对 auction / doomsday 生效,节奏不受控)。
 *    - 击杀归属在 update 里补记:僵尸死亡时读 lastHitBy,避免改动 B.kill 的通用分支。
 *    - 计分按 side 存,不按下标存:僵尸会插进 fighters,下标会漂移。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX, T = LD.Terrain;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);

  /* 清 / 加设施后重标占用格(照抄 49_bumpcar 的口径,地形层没有公开的 reindex) */
  function reindex(map) {
    if (!map || !map.occ) return;
    const tile = map.tile || 40, top = map.top != null ? map.top : 0;
    for (let r = 0; r < map.rows; r++) { const row = map.occ[r]; if (row) for (let c = 0; c < row.length; c++) row[c] = 0; }
    (map.props || []).forEach(p => {
      if (!p.blockMove || p.dead) return;
      const c0 = Math.max(0, Math.floor((p.x - p.w / 2) / tile));
      const c1 = Math.min(map.cols - 1, Math.floor((p.x + p.w / 2 - 1) / tile));
      const r0 = Math.max(0, Math.floor((p.y - p.h / 2 - top) / tile));
      const r1 = Math.min(map.rows - 1, Math.floor((p.y + p.h / 2 - 1 - top) / tile));
      for (let r = r0; r <= r1; r++) if (map.occ[r]) for (let c = c0; c <= c1; c++) map.occ[r][c] = 1;
    });
  }

  /* ==========================================================
   *  房子与刷点
   * ========================================================== */
  B.zhHouse = function () {
    const C = LD.ZOMBIEHOUSE || {};
    const top = this.world.pt || 0;
    return {
      x: this.world.w / 2,
      y: top + (this.world.h - top) / 2,
      r: C.r || 150
    };
  };

  /* 场边刷点:离房子足够远,不卡在设施里,也别贴脸刷 */
  B.zhSpawnSpot = function () {
    const H = this.zhHouse();
    const w = this.world.w, top = this.world.pt || 0;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU;
      const d = rand(w * 0.36, w * 0.46);
      const x = clamp(H.x + Math.cos(a) * d, 60, w - 60);
      const y = clamp(H.y + Math.sin(a) * d, top + 40, this.world.h - 60);
      if (Math.hypot(x - H.x, y - H.y) < H.r + 140) continue;
      if (this.humans(true).some(f => Math.hypot(f.x - x, f.y - y) < 200)) continue;
      if (!this.terrain || !T || !T.clearAt || T.clearAt(this.terrain, x, y, 26)) return { x: x, y: y };
    }
    /* 兜底:房子正左或正右一段距离 */
    const s = Math.random() < 0.5 ? -1 : 1;
    return {
      x: clamp(H.x + s * (H.r + 260), 60, w - 60),
      y: clamp(H.y, top + 40, this.world.h - 60)
    };
  };

  B.zhSpawnZombie = function () {
    const p = this.zhSpawnSpot();
    const z = this.mkZombie(p.x, p.y);
    this.fighters.push(z);          /* 必须入列,否则只是造出来不进战斗 */
    FX.ring(p.x, p.y - 26, 60, "rgba(163,230,53,.9)", 5, 0.5);
    return z;
  };

  /** 开第 n 波(从 1 起):算好本波总数压进待刷队列 */
  B.zhStartWave = function (n) {
    const C = LD.ZOMBIEHOUSE || {};
    const st = this.zh;
    if (!st) return;
    st.wave = n;
    st.phase = "fight";
    st.gapT = 0;
    st.queue = (C.base || 5) + (n - 1) * (C.grow || 3);
    st.spawnT = 0.4;
    const H = st.house;
    FX.ring(H.x, H.y - 40, H.r + 70, "rgba(248,113,113,.9)", 8, 0.7);
    FX.float(H.x, H.y - 132, "第 " + n + " 波来袭", "#f87171", 22);
    this.ev.push(["h", H.x, H.y - 132, "第 " + n + " 波来袭", "#f87171"]);
  };

  /* ==========================================================
   *  开局
   * ========================================================== */
  B.initZombieHouse = function () {
    const C = LD.ZOMBIEHOUSE || {};
    const H = this.zhHouse();
    const heroes = this.fighters.filter(f => f.kind === "hero" && !f.isZombie && !f.bench);

    /* 全员同队:互不伤害,枪口一致对外 */
    heroes.forEach(f => { f.team = 0; });

    /* 清掉房子占地里的设施,免得房里卡着树和箱子 */
    if (this.terrain && this.terrain.props) {
      this.terrain.props = this.terrain.props.filter(o => Math.hypot(o.x - H.x, o.y - H.y) > H.r - 12);
      reindex(this.terrain);
    }

    /* 把人摆到房子四周 */
    heroes.forEach((f, i) => {
      const a = i / Math.max(1, heroes.length) * TAU;
      f.x = H.x + Math.cos(a) * (H.r + 48);
      f.y = H.y + Math.sin(a) * (H.r + 48);
      f.vx = 0; f.vy = 0;
    });

    this.zh = {
      house: { x: H.x, y: H.y, r: H.r, hp: C.hp || 1200, maxHp: C.hp || 1200 },
      wave: 0,
      phase: "gap",          /* gap = 喘息期,fight = 交战中 */
      gapT: 3,               /* 开局先给 3 秒喘息 */
      queue: 0,
      spawnT: 0,
      score: {},             /* side -> 分数 */
      kills: {},             /* side -> 击杀数 */
      biteT: {},             /* side -> 下次啃房倒计时 */
      cred: {},              /* side -> 已补记过击杀 */
      done: false
    };
  };

  B.zhScoreOf = function (side) {
    const st = this.zh;
    return (st && st.score && st.score[side]) || 0;
  };

  /* ==========================================================
   *  每帧
   * ========================================================== */
  B.updateZombieHouse = function (dt) {
    const C = LD.ZOMBIEHOUSE || {};
    const st = this.zh;
    if (!st || st.done) return;
    const H = st.house;

    /* ---- 1. 喘息期:站进房子里修房,倒计时结束开下一波 ---- */
    if (st.phase === "gap") {
      st.gapT -= dt;
      const rate = C.repair || 90;
      if (rate > 0 && H.hp < H.maxHp) {
        const inside = this.fighters.some(f => f.kind === "hero" && !f.isZombie && !f.bench && !f.dead
          && Math.hypot(f.x - H.x, f.y - H.y) <= H.r);
        if (inside) {
          H.hp = Math.min(H.maxHp, H.hp + rate * dt);
          if (Math.random() < dt * 5) FX.float(H.x + rand(-46, 46), H.y - 58, "修复中", "#4ade80", 13);
        }
      }
      if (st.gapT <= 0) this.zhStartWave(st.wave + 1);
      return;
    }

    /* ---- 2. 本波僵尸逐个放出 ---- */
    if (st.queue > 0) {
      st.spawnT -= dt;
      if (st.spawnT <= 0) {
        st.spawnT = C.spawnEvery || 0.55;
        this.zhSpawnZombie();
        st.queue--;
      }
    }

    /* ---- 3. 僵尸啃房:进圈就咬,每只各走各的冷却 ---- */
    const biteTick = C.biteTick || 0.8, biteDmg = C.biteDmg || 22;
    for (const z of this.fighters) {
      if (!z.isZombie || z.dead) continue;
      if (Math.hypot(z.x - H.x, z.y - H.y) > H.r) continue;
      const key = z.side;
      st.biteT[key] = (st.biteT[key] || 0) - dt;
      if (st.biteT[key] > 0) continue;
      st.biteT[key] = biteTick;
      H.hp -= biteDmg;
      FX.burst(z.x, z.y - 18, 10, ["#a3e635", "#fca5a5"], { speed: 220 });
      FX.float(H.x, H.y - 100, "房子 -" + biteDmg, "#f87171", 16);
      this.ev.push(["h", H.x, H.y - 100, "房子 -" + biteDmg, "#f87171"]);
    }

    /* ---- 4. 击杀补记:僵尸刚死就把分记到最后一击的人头上 ---- */
    for (const f of this.fighters) {
      if (!f.isZombie || !f.dead || st.cred[f.side]) continue;
      st.cred[f.side] = 1;
      const by = f.lastHitBy;
      if (!by || by.isZombie || by.kind !== "hero") continue;
      const pts = C.scoreKill || 1;
      st.score[by.side] = (st.score[by.side] || 0) + pts;
      st.kills[by.side] = (st.kills[by.side] || 0) + 1;
      FX.float(by.x, by.y - 92, "击杀 +" + pts, "#fcd34d", 15);
    }

    /* ---- 5. 本波清空 → 进喘息;全部波次打完 → 结算 ---- */
    const alive = this.fighters.filter(f => f.isZombie && !f.dead).length;
    if (st.queue === 0 && alive === 0) {
      if (st.wave >= (C.waves || 5)) { this.zhFinish(false); return; }
      st.phase = "gap";
      st.gapT = C.gap || 8;
      FX.float(H.x, H.y - 116, "第 " + st.wave + " 波清空", "#4ade80", 20);
      this.ev.push(["h", H.x, H.y - 116, "第 " + st.wave + " 波清空", "#4ade80"]);
      return;
    }

    /* ---- 6. 房子被打穿 ---- */
    if (H.hp <= 0) { H.hp = 0; this.zhFinish(true); }
  };

  /**
   * 结算。broken = 房子被打穿(全员失败);否则按击杀数排名,最多者获胜。
   */
  B.zhFinish = function (broken) {
    const st = this.zh;
    if (!st || st.done) return;
    st.done = true;
    const heroes = this.fighters.filter(f => f.kind === "hero" && !f.isZombie && !f.bench);
    let best = null, bs = -1;
    heroes.forEach(f => {
      const s = st.score[f.side] || 0;
      if (s > bs) { bs = s; best = f; }
    });
    const me = this.hero(this.mySide == null ? 0 : this.mySide);
    const kills = best ? (st.kills[best.side] || 0) : 0;

    if (broken) {
      this.matchWinner = -1;
      if (best) LD.Cine.start(best, "房子被攻破", "", "#f87171", "击杀 " + kills + " · 守房失败");
      this.finish(false);
      return;
    }
    if (!best) { this.finish(false); return; }
    this.matchWinner = best.side;
    LD.Cine.start(best, "胜者:" + (best.name || ("玩家" + (best.side + 1))), "", "#fcd34d", kills + " 杀 · 守房铁卫");
    this.finish(!!(me && best && me.side === best.side));
  };

  /* ==========================================================
   *  渲染(世界坐标,ctx 已随摄像机平移)
   * ========================================================== */
  B.drawZombieHouse = function (ctx) {
    const st = this.zh;
    if (!st) return;
    const H = st.house;
    const t = this.t || 0;
    const k = clamp(H.hp / (H.maxHp || 1), 0, 1);

    /* 1. 地基圈:安全区 / 判定范围提示 */
    ctx.save();
    ctx.beginPath();
    ctx.arc(H.x, H.y, H.r, 0, TAU);
    ctx.fillStyle = "rgba(74,222,128,.10)";
    ctx.fill();
    ctx.setLineDash([18, 14]);
    ctx.lineDashOffset = -t * 18;
    ctx.strokeStyle = "rgba(74,222,128,.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* 2. 房子本体:墙 + 屋顶 + 门 */
    const bw = H.r * 1.05, bh = H.r * 0.76;
    ctx.save();
    ctx.fillStyle = "#7c5c3a";
    ctx.fillRect(H.x - bw / 2, H.y - bh / 2, bw, bh);
    ctx.fillStyle = "#5b4227";
    ctx.fillRect(H.x - bw / 2, H.y - bh / 2, bw, 9);
    ctx.beginPath();
    ctx.moveTo(H.x - bw / 2 - 15, H.y - bh / 2);
    ctx.lineTo(H.x, H.y - bh / 2 - 48);
    ctx.lineTo(H.x + bw / 2 + 15, H.y - bh / 2);
    ctx.closePath();
    ctx.fillStyle = "#b45309";
    ctx.fill();
    ctx.fillStyle = "#3f2d17";
    ctx.fillRect(H.x - 17, H.y + bh / 2 - 46, 34, 46);
    /* 两侧窗 */
    ctx.fillStyle = "#fde68a";
    ctx.fillRect(H.x - bw / 2 + 18, H.y - 12, 30, 26);
    ctx.fillRect(H.x + bw / 2 - 48, H.y - 12, 30, 26);
    ctx.restore();

    /* 3. 耐久条 */
    const barW = 138, barH = 11;
    const bx = H.x - barW / 2, by = H.y - bh / 2 - 78;
    ctx.save();
    ctx.fillStyle = "rgba(6,10,22,.78)";
    ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = k > 0.5 ? "#4ade80" : k > 0.25 ? "#fbbf24" : "#f87171";
    ctx.fillRect(bx, by, barW * k, barH);
    ctx.strokeStyle = "rgba(226,232,240,.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, barW + 1, barH + 1);
    ctx.restore();
  };
})(window.LD = window.LD || {});
