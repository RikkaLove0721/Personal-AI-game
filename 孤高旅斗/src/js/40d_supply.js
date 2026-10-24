/* ============================================================
 *  40d_supply.js - 局内供给：治疗包 / 金币 / 掉落池 / 拾取 / 军备商店 / 建筑与哨站
 *  自 40_battle.js 拆分（v4.12 工程债）。只搬代码，判定逻辑一行未改。
 * ============================================================ */
(function (LD) {
  "use strict";
  const C = LD.CONF, TAU = Math.PI * 2;
  const FX = LD.FX, V = LD.View;
  const clamp = V.clamp;
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const B = LD.Battle;

  /* ---- 军备竞赛：击杀掉金币，拾取攒局内金币；人机自动逛商店 ---- */
  B.spawnCoin = function (x, y, v) {
    if (!this.coins) this.coins = [];
    this.coins.push({ x, y, v: v || 1, t: 0 });
    FX.ring(x, y - 20, 40, "rgba(252,211,77,.9)", 5, 0.35);
  };
  /* v3.1 炸药桶：延迟一帧的地形爆炸结算（可以连锁引爆） */
  B.terrainBoom = function (x, y, r, dmg) {
    FX.ring(x, y - 12, r, "rgba(251,146,60,.95)", 8, 0.5);
    FX.ring(x, y - 12, r * 0.6, "rgba(254,215,170,.95)", 6, 0.38);
    FX.burst(x, y - 12, 34, ["#f97316", "#fbbf24", "#fff"], { speed: 360, life: 0.8 });
    FX.shake(14); FX.flash(0.14, "251,146,60");
    this.fighters.forEach(f => {
      if (f.dead) return;
      const d = Math.hypot(f.x - x, (f.y - 26) - y);
      if (d > r + f.r) return;
      const k = 1 - Math.max(0, d - f.r) / (r + f.r);
      this.damage(null, f, Math.round(dmg * (0.55 + 0.45 * k)), { type: "skill", kb: 320, from: { x: x, y: y + 26 } });
    });
    if (this.terrain) LD.Terrain.blast(this.terrain, x, y, r * 0.9, dmg * 0.8);
    this.ev.push(["x", x, y, r]);
  };

  /* v3.1 补给箱掉落：随机血包 / 道具包（原「能量包」，v4.10 统一改名）/ 移速包 */
  /* v4.10 道具包（+60 大招能量）只在这些模式之外的局里出现：
   * 停电夜战（大招禁用）、世界末日（用户反馈「居然能充电」）、护送情报箱（交互被充电抢走）。
   * v4.11 补：碰碰车竞技（同样禁用大招，且玩家全程在车里，`interactTarget` 的
   * rideCar 短路让道具包根本点不到，掉了也是白掉）；烫手山芋（禁用普攻技能大招）。
   * 物资刷新修饰符走同一个出口，一处拦截全部生效。
   * v4.12 补：一整批娱乐模式（木头人 / 抢椅子 / 躲猫猫 / 岩浆 / 弹幕 / 滑壶）
   * 同样禁用大招，掉了也用不了。 */
  B.packAllowed = function () {
    if (LD.isCasual && LD.isCasual(this.rule)) return false;
    return ["blackout", "doomsday", "escort", "bump", "hotpotato"].indexOf(this.rule) < 0;
  };
  B.dropPickup = function (x, y, forceKind) {
    if (forceKind === "energy" && !this.packAllowed()) {
      /* 停电夜战：大招禁用但血包 / 移速包在黑地里救命，转换品类继续掉；
       * 末日 / 护送：干脆不掉，场面上不要再冒出「按 P 充电」的交互。 */
      if (this.rule !== "blackout") return;
      forceKind = Math.random() < 0.5 ? "heal" : "speed";
    }
    /* v3.9.1 停电夜战的大招禁用兜底：随机掉落时也不再抽到道具包 */
    if (!forceKind && this.rule === "blackout") forceKind = Math.random() < 0.5 ? "heal" : "speed";
    /* v4.12 工程债：随机池统一尊重 packAllowed()——
     * 以前只有夜战做了兜底，末日 / 护送 / 碰碰车 / 山芋 / 本批娱乐模式打碎补给箱
     * 仍可能掉出用不了的道具包（走近有个 P 提示，按下去才发现是废的）。
     * 这里一处收敛，新增「禁用大招」的模式不用再各自打补丁。 */
    const pool = this.packAllowed() ? ["heal", "energy", "speed"] : ["heal", "speed"];
    const kind = forceKind || pool[(Math.random() * pool.length) | 0];
    if (!this.pickups) this.pickups = [];
    this.pickups.push({ id: (this._pkId = (this._pkId || 0) + 1), x: x, y: y, kind: kind, t: 0 });
    FX.ring(x, y - 10, 46, "rgba(125,211,252,.9)", 4, 0.4);
  };

  B.updatePickups = function (dt) {
    if (!this.pickups || !this.pickups.length) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t += dt;
      if (pk.t > 26) { this.pickups.splice(i, 1); continue; }
      /* v3.9 能量包不再「走过去自动吃掉」：必须靠近按交互键原地蓄力 5 秒。
       * 血包 / 移速包保持原来的接触即生效。 */
      for (const f of this.fighters) {
        if (f.dead || f.bench || f.kind !== "hero") continue;
        if (Math.hypot(f.x - pk.x, f.y - pk.y) > f.r + 24) continue;
        if (pk.kind === "energy") continue;
        const label = pk.kind === "heal" ? "生命 +35" : "移速提升 5 秒";
        if (pk.kind === "heal") this.heal(f, 35);
        else f.speedBoostT = Math.max(f.speedBoostT || 0, 5);
        FX.float(f.x, f.y - 64, label, pk.kind === "heal" ? "#7ff0c4" : pk.kind === "energy" ? "#a5b4fc" : "#fcd34d", 14);
        FX.burst(pk.x, pk.y - 10, 12, ["#7dd3fc", "#fff"], { speed: 180 });
        FX.ring(f.x, f.y - 26, 52, "rgba(125,211,252,.85)", 4, 0.35);
        this.pickups.splice(i, 1);
        break;
      }
    }
  };

  B.updateAuction = function (dt) {
    if (!this.coins) return;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      if (c.t > 25) { this.coins.splice(i, 1); continue; }
      for (const f of this.fighters) {
        if (f.dead || f.kind !== "hero" || f.isZombie || f.bench) continue;
        if (Math.hypot(f.x - c.x, f.y - c.y) < f.r + 22) {
          f.bcoins = (f.bcoins || 0) + c.v;
          FX.float(f.x, f.y - 60, "+" + c.v + " 局内金币", "#fcd34d", 14);
          FX.burst(c.x, c.y - 10, 8, ["#fcd34d", "#fff"], { speed: 150 });
          this.coins.splice(i, 1);
          if (f.isBot) this.botSpin(f);
          break;
        }
      }
    }
  };
  /* v2.7 军备竞赛：局内商店（打僵尸/杀人掉金币，金币买增益，只在当局有效） */
  B.armyShop = function () {
    const S = LD.ASHOP || {};
    /* v4.10 世界末日：低于 10 金币的道具价格全部 ×2（末日金币好赚，低价货白送一样） */
    const px = (p) => (this.rule === "doomsday" && p < 10 ? p * 2 : p);
    return [
      { id: "heal", name: "血包", icon: "❤️", price: px(S.healPrice || 2),
        desc: "立刻恢复 " + (S.healAmount || 45) + " 点生命（满血时买不了）" },
      { id: "hp", name: "血量加成", icon: "💪", price: px(S.hpPrice || 2),
        desc: "本局生命上限 +" + (S.hpGain || 80) + " 并回满增量，可叠加" },
      { id: "spd", name: "移速加成", icon: "👟", price: px(S.spdPrice || 2),
        desc: "本局移速 +" + Math.round((S.spdGain || 0.15) * 100) + "%（最多叠 " + (S.spdMax || 3) + " 次）" },
      { id: "energy", name: "能量球", icon: "🔮", price: px(S.energyPrice || 3),
        desc: "立刻补充 " + (S.energyGain || 60) + " 点大招能量（能量已满时买不了）" }
    ].concat(this.rule === "doomsday" ? (function () {
      /* v4.1 末日专属：防御建筑，买完立在脚下（金币靠刷僵尸攒）；同样吃 <10 金币翻倍 */
      const C = (LD.DOOMSDAY || {}).build || {};
      return [
        { id: "b_fence", name: "栅栏", icon: "🚧", price: px((C.fence || {}).price || 6),
          desc: "在脚下立一段可破坏栅栏（血量 " + ((C.fence || {}).hp || 80) + "）：挡人不挡弹，飞行物可以穿过去" },
        { id: "b_turret", name: "小型枪台", icon: "🔫", price: (C.turret || {}).price || 14,
          desc: "在脚下架起枪台（血量 " + ((C.turret || {}).hp || 120) + "）：自动射击 " + ((C.turret || {}).range || 300) + " 范围内的僵尸，并优先吸引它们仇恨" },
        { id: "b_cannon", name: "固定炮台", icon: "💥", price: (C.cannon || {}).price || 22,
          desc: "在脚下架起炮台（血量 " + ((C.cannon || {}).hp || 160) + "）：低频发射范围爆炸的炮弹（" + ((C.cannon || {}).boomR || 90) + " 范围），同样吸引仇恨" }
      ];
    })() : []);
  };
  /** 购买局内商品：成功返回 true（扣金币 + 立刻生效） */
  B.armyBuy = function (f, id) {
    const S = LD.ASHOP || {};
    const item = this.armyShop().find(i => i.id === id);
    if (!f || !item) return false;
    if ((f.bcoins || 0) < item.price) return false;
    if (id === "heal") {
      if (f.hp >= f.maxHp) return false;
      f.bcoins -= item.price;
      f.hp = Math.min(f.maxHp, f.hp + (S.healAmount || 45));
      FX.ring(f.x, f.y - 26, 62, "#4ade80", 5, 0.45);
      FX.float(f.x, f.y - 64, "+" + (S.healAmount || 45), "#4ade80", 15);
    } else if (id === "hp") {
      f.bcoins -= item.price;
      f.maxHp += (S.hpGain || 80); f.hp += (S.hpGain || 80);
      FX.ring(f.x, f.y - 26, 66, "#fb7185", 5, 0.45);
      FX.float(f.x, f.y - 64, "上限+" + (S.hpGain || 80), "#fb7185", 15);
    } else if (id === "spd") {
      if ((f.spdBuys || 0) >= (S.spdMax != null ? S.spdMax : 3)) return false;
      f.bcoins -= item.price;
      f.spdBuys = (f.spdBuys || 0) + 1;
      f.speedMul = (f.speedMul || 1) + (S.spdGain || 0.15);
      FX.ring(f.x, f.y - 26, 66, "#67e8f9", 5, 0.45);
      FX.float(f.x, f.y - 64, "移速+" + Math.round((S.spdGain || 0.15) * 100) + "%", "#67e8f9", 15);
    } else if (id === "energy") {
      /* v3.2 能量球：立刻补大招能量 */
      if (f.energy >= f.maxEnergy) return false;
      f.bcoins -= item.price;
      const gain = S.energyGain || 60;
      f.energy = Math.min(f.maxEnergy, f.energy + gain);
      FX.ring(f.x, f.y - 26, 66, "#818cf8", 5, 0.45);
      FX.burst(f.x, f.y - 26, 14, ["#a5b4fc", "#fff"], { speed: 180 });
      FX.float(f.x, f.y - 64, "能量+" + gain, "#a5b4fc", 15);
    } else if (id === "b_fence" || id === "b_turret" || id === "b_cannon") {
      /* v4.1 末日防御建筑：扣钱放在 placeStructure 里做（放不下不扣钱） */
      if (!this.placeStructure(f, id.slice(2))) return false;
    } else return false;
    if (typeof Audio2 !== "undefined" && Audio2.buy) Audio2.buy();
    return true;
  };

  /* ==========================================================
   *  v4.1 世界末日：商店防御建筑（栅栏 / 小型枪台 / 固定炮台）
   *  买完立在玩家面朝方向 52px 处；枪台自动点射、炮台范围轰炸，
   *  两者都会把附近僵尸的仇恨从玩家身上抢过来（贴身的僵尸改为啃建筑）。
   * ========================================================== */
  B.placeStructure = function (f, kind) {
    if (!f || f.dead || !this.terrain) return false;
    const D = (LD.DOOMSDAY || {}).build || {};
    const cfg = D[kind];
    if (!cfg) return false;
    if ((f.bcoins || 0) < cfg.price) return false;
    const T = LD.Terrain, TILE = LD.TERRAIN.tile || 40;
    const fx = f.facing ? f.facing.x : 1, fy = f.facing ? f.facing.y : 0;
    const fd = Math.hypot(fx, fy) || 1;
    let px = f.x + fx / fd * 52, py = f.y + fy / fd * 52;
    px = Math.max(TILE, Math.min(this.world.w - TILE, px));
    py = Math.max(this.world.pt + TILE, Math.min(this.world.h - TILE, py));
    /* 末日地图：只能立在陆地（岛 / 桥 / 大陆）上，悬崖上放不了 */
    if (T.landAt && !T.landAt(px, py)) {
      const p2 = T.landFit ? T.landFit(px, py) : null;
      if (!p2) { FX.float(f.x, f.y - 64, "那里是悬崖", "#f87171", 14); return false; }
      px = p2.x; py = p2.y;
    }
    if (!T.clearAt(this.terrain, px, py, 20)) {
      FX.float(f.x, f.y - 64, "这里放不下", "#f87171", 14); return false;
    }
    const spec = {
      fence:  { kind: "barrier", mat: "fence_wood", shape: "bar",   elev: 28, mass: 1.0 },
      turret: { kind: "turret",  mat: "metal",      shape: "round", elev: 34, mass: 3.4 },
      cannon: { kind: "cannon",  mat: "metal",      shape: "round", elev: 36, mass: 4.2 }
    }[kind];
    const name = { fence: "栅栏", turret: "小型枪台", cannon: "固定炮台" }[kind];
    this.terrain.props.push({
      uid: 950000 + ((this._structSeq = (this._structSeq || 0) + 1)),
      kind: spec.kind, mat: spec.mat, shape: spec.shape,
      cw: 1, ch: 1, w: TILE, h: TILE,
      x: px, y: py, ox: px, oy: py,
      elev: spec.elev, mass: spec.mass,
      hp: cfg.hp, maxHp: cfg.hp,
      dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: null,
      boomR: 0, boomDmg: 0, variant: (this._structSeq * 137) % 997,
      soft: false, blockMove: true,
      blockProj: spec.kind !== "barrier",
      side: f.side, owner: f, shotT: 0, aimAngle: 0
    });
    f.bcoins -= cfg.price;
    FX.ring(px, py, 44, "#fbbf24", 5, 0.45);
    FX.burst(px, py - 16, 12, ["#fde68a", "#fff"], { speed: 170 });
    FX.float(px, py - 56, name + "！", "#fbbf24", 15);
    if (typeof Audio2 !== "undefined" && Audio2.buy) Audio2.buy();
    return true;
  };
  /** 离 f 最近的防御建筑（僵尸抢仇恨 / 啃咬都用它），r 内没有返回 null */
  B.guardPostNear = function (f, r) {
    if (!this.terrain) return null;
    let best = null, bd = r;
    for (const o of this.terrain.props) {
      if (o.dead || (o.kind !== "turret" && o.kind !== "cannon")) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };
  B.updateGuardPosts = function (dt) {
    if (this.rule !== "doomsday" || !this.terrain) return;
    const D = (LD.DOOMSDAY || {}).build || {};
    for (const o of this.terrain.props) {
      if (o.dead || (o.kind !== "turret" && o.kind !== "cannon")) continue;
      const S = D[o.kind] || {};
      o.shotT = Math.max(0, (o.shotT || 0) - dt);
      const range = S.range || 300;
      let best = null, bd = Infinity;
      for (const z of this.fighters) {
        if (z.dead || !z.isZombie) continue;
        const d = Math.hypot(z.x - o.x, z.y - o.y);
        if (d <= range && d < bd) { bd = d; best = z; }
      }
      o._target = best;
      if (!best) continue;
      const oy = o.y - (o.elev || 34) * 0.5;
      o.aimAngle = Math.atan2(best.y - 26 - oy, best.x - o.x);
      if (o.shotT > 0) continue;
      o.shotT = S.atk || 1.1;
      const owner = o.owner;   // owner 只做伤害归属（金币/分数），死了也照算
      if (o.kind === "turret") {
        /* 小型枪台：高速点射弹（不吃 blockProj？吃的，正常飞行物） */
        const a = o.aimAngle, sp = S.projSpeed || 920;
        this.spawnProj({
          x: o.x + Math.cos(a) * 18, y: oy + Math.sin(a) * 12,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          r: 7, dmg: S.dmg || 12, life: 1.8, owner: owner,
          color: "#fbbf24", core: "#fff7d6", type: "turretshot", kindTag: "skill", trail: true
        });
        FX.burst(o.x + Math.cos(a) * 20, oy, 5, ["#fbbf24", "#fff"], { speed: 130, dir: a });
      } else {
        /* 固定炮台：低频范围轰炸 —— 朝目标当前位置落一发延迟炮弹（复用高压弹通道） */
        this.bombs = this.bombs || [];
        this.bombs.push({ x: best.x, y: best.y, t: S.shellT || 0.55, max: S.shellT || 0.55,
          owner: owner, r: S.boomR || 90, dmg: S.dmg || 34, cannon: true });
        FX.ring(o.x, oy, 30, "rgba(251,191,36,.9)", 4, 0.35);
      }
    }
    /* 僵尸啃咬：被枪台/炮台吸引过来的僵尸，贴近就啃建筑（建筑是它们唯一够得着的敌人） */
    for (const z of this.fighters) {
      if (z.dead || !z.isZombie) continue;
      z.biteT = Math.max(0, (z.biteT || 0) - dt);
      if (z.biteT > 0) continue;
      const post = this.guardPostNear(z, 64);
      if (!post) continue;
      z.biteT = 0.8;
      LD.Terrain.hitProp(this.terrain, post, 12, { melee: true, src: z });
      FX.burst(post.x + rand(-10, 10), post.y - 30, 5, ["#a3e635", "#fff"], { speed: 120 });
    }
  };

})(window.LD = window.LD || {});
