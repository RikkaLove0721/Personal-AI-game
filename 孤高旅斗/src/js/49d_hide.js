/* ============================================================
 *  49d_hide.js — v4.12 躲猫猫
 * ============================================================
 *  开局随机一人当鬼（血更厚、跑得略快），其余人躲。
 *    - 躲的人可以钻柜子 / 猫草丛（复用现成的隐匿机制）
 *    - 鬼贴到身边直接抓（目标不在隐匿状态才算抓到）
 *    - 鬼站在柜子 / 草丛旁会自动搜查 0.9 秒，把里面的人揪出来
 *    - 被抓的人**反过来变成鬼**，一起去抓剩下的人（这是本模式最大的乐趣：
 *      前期被抓不亏，只是换个阵营继续玩）
 *
 *  胜负：撑到时间结束还有人没被抓 → 躲藏者赢；躲藏者被抓光 → 鬼赢。
 *  禁用普攻 / 技能 / 大招，全程不能出手。
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, FX = LD.FX;
  const U = LD.casualUtil;
  const clamp = U.clamp, rnd = U.rnd, pick = U.pick, TAU = U.TAU;
  const C = () => LD.HIDE || {};

  const C_SEEK = "#f87171", C_HIDE = "#7dd3fc", C_GOLD = "#fbbf24";

  /** 可躲藏的物件：柜子（钻进去）与草丛（猫进去） */
  B.hideSpots = function () {
    const props = (this.terrain && this.terrain.props) || [];
    return props.filter(o => !o.dead && (o.kind === "locker" || o.kind === "bush"));
  };

  /** 某个躲藏点里此刻有没有藏人 */
  B.hideOccupant = function (o) {
    if (!o || o.dead) return null;
    if (o.occupant && !o.occupant.dead) return o.occupant;
    if (o.kind === "bush") {
      for (const f of B.fighters) {
        if (f.kind !== "hero" || f.dead || f.bench) continue;
        if (!f.inBush) continue;
        if (Math.abs(f.x - o.x) < (o.w || 80) / 2 + 6 && Math.abs(f.y - o.y) < (o.h || 80) / 2 + 6) return f;
      }
    }
    return null;
  };

  B.initHide = function () {
    const c = C(), w = this.world;
    const alive = this.casualAlive();

    /* 躲猫猫必须有足够的藏身点：不够就现场补柜子 / 草丛 */
    const need = alive.length + 2;
    for (let i = B.hideSpots.call(this).length; i < need; i++) {
      const bush = Math.random() < 0.5;
      const x = rnd(120, w.w - 120), y = rnd(w.pt + 90, w.h - 90);
      B.casualAddProp.call(this, bush ? "bush" : "locker", bush ? "bush_leaf" : "locker_wood", x, y, bush ? 2 : 1, bush ? 2 : 1);
    }

    /* 随机一人当鬼；为了保证「有人能玩」，人数 ≥ 3 时才随机，2 人局固定第 0 位当鬼 */
    const si = alive.length >= 3 ? (Math.random() * alive.length) | 0 : 0;
    alive.forEach((f, i) => {
      f.hideRole = (i === si) ? "seeker" : "hider";
      f.maxHp = f.hideRole === "seeker" ? (c.seekerHp || 300) : (c.hiderHp || 200);
      f.hp = f.maxHp;
      f.hideT = 0; f.hideAim = null; f.hideAimT = 0;
      f.searched = {};
    });
    /* 鬼落在场地一侧，躲的人铺在另一侧远处 */
    const sk = alive[si];
    const pts = alive.map((f, i) => (i === si)
      ? { x: 110, y: (w.pt + w.h) / 2 }
      : { x: rnd(w.w * 0.45, w.w - 120), y: rnd(w.pt + 90, w.h - 90) });
    this.casualPlace(pts, alive);
    if (sk) {
      FX.ring(sk.x, sk.y - 26, 80, "rgba(248,113,113,.9)", 6, 0.5);
      FX.float(sk.x, sk.y - 96, "你就是鬼！", C_SEEK, 20);
    }
    this.hide = { hintT: c.hintEvery || 6, search: null, caught: 0, firstSeeker: sk ? sk.side : 0 };
    FX.float(w.w / 2, w.pt + 40, "躲猫猫开始——快藏起来", C_GOLD, 20);
  };

  /** 把一个人变成鬼 */
  B.hideTurnSeeker = function (f) {
    const c = C();
    if (!f || f.hideRole === "seeker") return;
    f.hideRole = "seeker";
    f.maxHp = c.seekerHp || 300;
    f.hp = Math.max(f.hp, Math.round(f.maxHp * 0.6));
    f.hideT = 0;
    if (f.hideProp && this.ejectLocker) this.ejectLocker(f);
    FX.ring(f.x, f.y - 26, 78, "rgba(248,113,113,.95)", 6, 0.5);
    FX.float(f.x, f.y - 96, "被抓到了！你也是鬼了", C_SEEK, 19);
    this.ev.push(["h", f.x, f.y - 96, "被抓到了！你也是鬼了", C_SEEK]);
    FX.shake(8);
    if (LD.Audio && LD.Audio.beep) LD.Audio.beep(240, 0.2, "sawtooth", 0.06);
    this.hide.caught++;
  };

  B.updateHide = function (dt) {
    const st = this.hide, c = C();
    if (!st) return;
    const alive = this.casualAlive();
    const seekers = alive.filter(f => f.hideRole === "seeker");
    const hiders = alive.filter(f => f.hideRole === "hider");

    /* ---- 胜负 ---- */
    if (!hiders.length && seekers.length) { this.casualWin(seekers[0], "全被抓到了！"); return; }
    if (!seekers.length && hiders.length) { this.casualWin(hiders[0], "鬼全没了！"); return; }

    /* ---- 鬼贴身抓人 ---- */
    for (const s of seekers) {
      if (s.dead) continue;
      for (const h of hiders) {
        if (h.dead) continue;
        const hidden = !!(h.hideProp || h.bushHide);
        if (hidden) continue;
        if (Math.hypot(h.x - s.x, h.y - s.y) > (c.catchR || 46) + h.r) continue;
        this.hideTurnSeeker(h);
        break;
      }
    }

    /* ---- 鬼搜查柜子 / 草丛：站在旁边 searchNeed 秒自动揪人 ---- */
    if (st.search) {
      const s = st.search;
      const sk = s.who;
      if (!sk || sk.dead || sk.hideRole !== "seeker" || !s.prop || s.prop.dead) { st.search = null; }
      else if (Math.hypot(sk.x - s.prop.x, sk.y - s.prop.y) > (c.searchR || 64) + Math.max(s.prop.w || 40, s.prop.h || 40) / 2) {
        st.search = null;                       // 走开就中断
      } else {
        s.t += dt;
        if (s.t >= (c.searchNeed || 0.9)) {
          const occ = B.hideOccupant(s.prop);
          st.search = null;
          if (occ && occ.hideRole === "hider") {
            if (occ.hideProp && this.ejectLocker) this.ejectLocker(occ);
            this.hideTurnSeeker(occ);
          } else {
            FX.float(s.prop.x, s.prop.y - 60, "空的", "#94a3b8", 14);
            sk.searched[s.prop.uid] = 1;        // 记下来，别再搜第二遍
          }
        }
      }
    }
    if (!st.search) {
      for (const sk of seekers) {
        if (sk.dead) continue;
        let best = null, bd = Infinity;
        for (const o of B.hideSpots.call(this)) {
          if (sk.searched && sk.searched[o.uid]) continue;
          const d = Math.hypot(sk.x - o.x, sk.y - o.y);
          if (d > (c.searchR || 64) + Math.max(o.w || 40, o.h || 40) / 2) continue;
          if (d < bd) { bd = d; best = o; }
        }
        if (best) { st.search = { who: sk, prop: best, t: 0 }; break; }
      }
    }

    /* ---- 心跳提示：鬼靠近时给躲藏者一点方位感（也让局面不至于干等） ---- */
    st.hintT -= dt;
    if (st.hintT <= 0) {
      st.hintT = c.hintEvery || 6;
      for (const h of hiders) {
        let near = null, nd = Infinity;
        for (const s of seekers) {
          const d = Math.hypot(h.x - s.x, h.y - s.y);
          if (d < nd) { nd = d; near = s; }
        }
        if (!near || nd > (c.hintR || 430)) continue;
        const ang = Math.atan2(near.y - h.y, near.x - h.x);
        const k = 1 - clamp(nd / (c.hintR || 430), 0, 1);
        FX.float(h.x + Math.cos(ang) * 40, h.y - 100 + Math.sin(ang) * 20,
          k > 0.6 ? "鬼就在旁边！" : "有动静…", k > 0.6 ? C_SEEK : C_GOLD, 13 + Math.round(k * 5));
      }
    }
  };

  B.hideTimeUp = function () {
    const alive = this.casualAlive();
    const hiders = alive.filter(f => f.hideRole === "hider");
    const seekers = alive.filter(f => f.hideRole === "seeker");
    if (hiders.length) this.casualWin(hiders[0], "躲到最后了！");
    else if (seekers.length) this.casualWin(seekers[0], "全被抓到了！");
    else this.endRound(0);
  };

  /* ---------------- 渲染 ---------------- */
  B.drawHide = function (ctx) {
    const st = this.hide, w = this.world;
    if (!st) return;

    /* 搜查进度条 */
    if (st.search && st.search.who && !st.search.who.dead) {
      const s = st.search, c = C();
      const k = clamp(s.t / (c.searchNeed || 0.9), 0, 1);
      ctx.save();
      ctx.translate(s.prop.x, s.prop.y - Math.max(s.prop.h || 40, 40) / 2 - 26);
      ctx.fillStyle = "rgba(15,23,42,.75)";
      ctx.fillRect(-30, -6, 60, 10);
      ctx.fillStyle = C_SEEK;
      ctx.fillRect(-28, -4, 56 * k, 6);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("搜查中", 0, -10);
      ctx.restore();
    }

    /* 鬼头顶标记 */
    ctx.save();
    ctx.font = "bold 12px system-ui,'Microsoft YaHei',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const f of this.casualAlive()) {
      ctx.fillStyle = f.hideRole === "seeker" ? C_SEEK : C_HIDE;
      ctx.beginPath(); ctx.arc(f.x, f.y - 104, 4, 0, TAU); ctx.fill();
      ctx.fillText(f.hideRole === "seeker" ? "鬼" : "躲", f.x, f.y - 120);
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 15px system-ui,'Microsoft YaHei',sans-serif";
    const hiders = this.casualAlive().filter(f => f.hideRole === "hider").length;
    ctx.fillStyle = C_GOLD;
    ctx.fillText("还有 " + hiders + " 人没被抓到", w.w / 2, w.pt + 14);
    ctx.restore();
  };

  /* ---------------- 人机 ---------------- */
  LD.casualAI.hide = function (f, dt, ctrl) {
    const c = LD.HIDE || {};
    ctrl.press = {};
    if (!B.hide) { ctrl.mx = 0; ctrl.my = 0; return; }
    const w = B.world;
    const alive = B.casualAlive();
    const seekers = alive.filter(o => o.hideRole === "seeker");

    /* ---------- 鬼 ---------- */
    if (f.hideRole === "seeker") {
      /* 正在搜查就站住别动 */
      if (B.hide.search && B.hide.search.who === f) { ctrl.mx = 0; ctrl.my = 0; return; }
      /* 看得见的躲藏者优先追 */
      let tgt = null, td = Infinity;
      for (const h of alive) {
        if (h.hideRole !== "hider" || h.dead) continue;
        if (h.hideProp || h.bushHide) continue;
        const d = Math.hypot(h.x - f.x, h.y - f.y);
        if (d < td) { td = d; tgt = h; }
      }
      let tx, ty;
      if (tgt) { tx = tgt.x; ty = tgt.y; }
      else {
        /* 没看见人 → 去下一个还没搜过的藏身点（几个鬼分头搜，别扎堆） */
        f.hideAimT = (f.hideAimT || 0) - dt;
        const spots = B.hideSpots().filter(o => !(f.searched && f.searched[o.uid]));
        if (!f.hideAim || f.hideAim.dead || f.hideAimT <= 0 || spots.indexOf(f.hideAim) < 0) {
          const mates = seekers.filter(o => o !== f);
          let best = null, bs = -Infinity;
          spots.forEach(o => {
            const d = Math.hypot(o.x - f.x, o.y - f.y);
            let taken = 0;
            mates.forEach(m => { if (m.hideAim === o) taken = 1; });
            const score = -d - taken * 400;
            if (score > bs) { bs = score; best = o; }
          });
          f.hideAim = best || (spots.length ? spots[(Math.random() * spots.length) | 0] : null);
          f.hideAimT = 6;
        }
        if (f.hideAim) { tx = f.hideAim.x; ty = f.hideAim.y; }
        else { tx = rnd(120, w.w - 120); ty = rnd(w.pt + 90, w.h - 90); }
      }
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      const s = LD.AI.steer(f, dx / d, dy / d, null);
      ctrl.mx = s.x; ctrl.my = s.y;
      return;
    }

    /* ---------- 躲藏者 ---------- */
    /* 已经在柜子里：躲太久（10 秒）就出来换地方，别死蹲一个点 */
    if (f.hideProp) {
      f.hideT += dt;
      if (f.hideT > 10) { ctrl.press.interact = true; f.hideT = 0; }
      else { ctrl.mx = 0; ctrl.my = 0; }
      return;
    }
    f.hideT += dt;
    let near = null, nd = Infinity;
    for (const s of seekers) {
      const d = Math.hypot(f.x - s.x, f.y - s.y);
      if (d < nd) { nd = d; near = s; }
    }
    const danger = nd < 460;
    if (danger) {
      /* 危险：往离鬼最远的藏身点跑，跑到了就钻进去 */
      const spots = B.hideSpots();
      let best = null, bs = -Infinity;
      spots.forEach(o => {
        if (o.kind === "locker" && o.occupant) return;
        const dSelf = Math.hypot(o.x - f.x, o.y - f.y);
        const dSeeker = Math.hypot(o.x - near.x, o.y - near.y);
        const score = dSeeker - dSelf * 0.75;
        if (score > bs) { bs = score; best = o; }
      });
      if (best) {
        const dx = best.x - f.x, dy = best.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (d > 26) {
          const s = LD.AI.steer(f, dx / d, dy / d, null);
          ctrl.mx = s.x; ctrl.my = s.y;
        } else if (best.kind === "locker") {
          ctrl.mx = 0; ctrl.my = 0;
          ctrl.press.interact = true;          // 钻柜子
          f.hideT = 0;
        } else {
          ctrl.mx = 0; ctrl.my = 0;            // 草丛：站进去自动伪装
        }
        return;
      }
    }
    /* 安全：在离鬼较远的区域慢慢挪，把自己挪到一个还没去过的藏身点附近待命 */
    f.hideAimT = (f.hideAimT || 0) - dt;
    if (!f.hideAim || f.hideAim.dead || f.hideAimT <= 0) {
      const spots = B.hideSpots();
      let best = null, bs = -Infinity;
      spots.forEach(o => {
        if (o.kind === "locker" && o.occupant) return;
        const dSeeker = near ? Math.hypot(o.x - near.x, o.y - near.y) : 800;
        const dSelf = Math.hypot(o.x - f.x, o.y - f.y);
        const score = dSeeker - dSelf * 0.4 + rnd(0, 120);   // 随机项：别所有 AI 扎同一个点
        if (score > bs) { bs = score; best = o; }
      });
      f.hideAim = best; f.hideAimT = rnd(4, 9);
    }
    if (f.hideAim) {
      const dx = f.hideAim.x - f.x, dy = f.hideAim.y - f.y, d = Math.hypot(dx, dy) || 1;
      if (d > 34) {
        const s = LD.AI.steer(f, dx / d, dy / d, null);
        ctrl.mx = s.x * 0.8; ctrl.my = s.y * 0.8;
      } else { ctrl.mx = 0; ctrl.my = 0; }
    } else { ctrl.mx = 0; ctrl.my = 0; }
  };
})(window.LD = window.LD || {});
