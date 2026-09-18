/* ============================================================
 *  70_ui.js — 界面 / 商店 / 帮助 / HUD / 输入
 * ============================================================ */
(function (LD) {
  "use strict";
  const B = LD.Battle, C = LD.CONF, P = LD.Profile, V = LD.View;
  const $ = id => document.getElementById(id);

  /* ==========================================================
   *  音效（WebAudio，无外部资源）
   * ========================================================== */
  const Audio2 = LD.Audio = {
    ctx: null, muted: false,
    init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } } },
    beep(freq, dur, type, vol) {
      if (this.muted) return; this.init(); if (!this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type || "square"; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime((vol == null ? 0.07 : vol), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur);
      } catch (e) {}
    },
    hit() { this.beep(180, 0.07, "square", 0.06); this.beep(90, 0.09, "triangle", 0.05); },
    parry() { this.beep(1180, 0.16, "sawtooth", 0.06); this.beep(720, 0.12, "square", 0.04); },
    ult() { this.beep(150, 0.5, "sawtooth", 0.07); setTimeout(() => this.beep(320, 0.4, "square", 0.05), 90); },
    cast() { this.beep(430, 0.09, "triangle", 0.05); },
    buy() { this.beep(760, 0.1, "sine", 0.06); setTimeout(() => this.beep(1080, 0.14, "sine", 0.05), 80); },
    ui() { this.beep(560, 0.05, "sine", 0.035); },
    win() { [520, 660, 800, 1040].forEach((f, i) => setTimeout(() => this.beep(f, 0.2, "sine", 0.06), i * 110)); },
    lose() { [420, 330, 250].forEach((f, i) => setTimeout(() => this.beep(f, 0.28, "triangle", 0.06), i * 150)); }
  };

  /* ==========================================================
   *  界面控制
   * ========================================================== */
  const OVS = ["ovMenu", "ovSolo", "ovLevels", "ovDuelSetup", "ovMulti", "ovJoin", "ovWait", "ovSkin", "ovSkill", "ovLoad", "ovHelp", "ovEnd"];
  const UI = LD.UI = { screen: "ovMenu" };

  UI.show = function (id) {
    OVS.forEach(o => { const e = $(o); if (e) e.classList.toggle("hide", o !== id); });
    this.screen = id;
    $("hud").classList.toggle("on", id === "game");
    UI.coins();
    if (id === "ovSkin") UI.renderSkin();
    if (id === "ovSkill") UI.renderSkill();
    if (id === "ovLevels") UI.renderLevels();
    if (id === "ovLoad") UI.renderLoad();
    if (id === "ovHelp") UI.renderHelp();
  };

  UI.coins = function () {
    document.querySelectorAll(".coinNum").forEach(e => { e.textContent = P.d.coins; });
    const c = $("cheatCount");
    if (c) c.textContent = P.d.cheat ? "已使用 " + P.d.cheat + " 次" : "";
  };

  UI.toast = function (msg, gold) {
    const w = $("toast");
    const d = document.createElement("div");
    d.className = "tst" + (gold ? " gold" : "");
    d.textContent = msg;
    w.appendChild(d);
    setTimeout(() => { d.style.transition = "opacity .3s"; d.style.opacity = "0"; setTimeout(() => d.remove(), 320); }, 1500);
  };

  UI.tip = function (msg) {
    const t = $("tip");
    if (!msg) { t.classList.remove("on"); return; }
    t.textContent = msg; t.classList.add("on");
  };

  /* ==========================================================
   *  金币购买通用
   * ========================================================== */
  function doBuy(r, name) {
    if (r.ok) { Audio2.buy(); UI.toast("已购买「" + name + "」", true); UI.coins(); }
    else { Audio2.beep(200, 0.14, "square", 0.05); UI.toast("购买失败：" + r.why); }
    return r.ok;
  }

  /* ==========================================================
   *  皮肤商店
   * ========================================================== */
  UI.skinTab = "head";
  UI.renderSkin = function () {
    const part = this.skinTab;
    const wrap = $("skinShop");
    wrap.innerHTML = "";
    LD.partsBy(part).forEach(p => {
      const owned = P.ownsPart(p.id), eq = P.d.equip[part] === p.id;
      const d = document.createElement("div");
      d.className = "item" + (owned ? " own" : "") + (eq ? " eq" : "") + (!owned && P.d.coins >= p.price ? " can" : "");
      d.innerHTML =
        '<div class="pv"><canvas width="120" height="150" style="width:60px;height:75px"></canvas></div>' +
        '<div class="nm">' + p.name + '</div>' +
        '<div class="pr">' + (eq ? "已装备" : owned ? "点击穿上" : "🪙 " + p.price) + '</div>' +
        (owned ? '<div class="st' + (eq ? ' eq' : '') + '">' + (eq ? "★" : "✓") + '</div>' : '');
      d.onclick = () => {
        Audio2.ui();
        if (owned) { P.equipPart(p.id); UI.toast("已换上「" + p.name + "」"); UI.renderSkin(); }
        else doBuy(P.buyPart(p.id), p.name);
      };
      wrap.appendChild(d);
      const cv = d.querySelector("canvas");
      V.heroPreview(cv, previewLookFor(p), 0);
    });
    document.querySelectorAll("#skinTabs .tab").forEach(t => t.classList.toggle("on", t.dataset.part === part));
    UI.refreshSkinPv();
  };

  // 预览：把某个部件临时换上
  function previewLookFor(p) {
    const look = P.look();
    const key = p.part === "head" ? "head" : p.part;
    if (p.part === "head") look.head = { model: p.model, c1: p.c1, c2: p.c2, c3: p.c3 };
    else if (p.part === "upper") look.upper = { c1: p.c1, c2: p.c2 };
    else look.lower = { c1: p.c1, c2: p.c2 };
    return look;
  }

  UI.refreshSkinPv = function () { V.heroPreview($("skinPv"), P.look(), 0); };

  /* ==========================================================
   *  技能商店
   * ========================================================== */
  UI.skillTab = "basic";
  const SLOT_LAB = { basic: "J", skill1: "K", skill2: "L", ult: "O" };

  UI.renderSkill = function () {
    const kind = this.skillTab;
    // 装配栏
    const lb = $("loadBar");
    lb.innerHTML = "";
    ["basic", "skill1", "skill2", "ult"].forEach(slot => {
      const id = P.d.loadout[slot], sk = LD.skill(id);
      const d = document.createElement("div");
      d.className = "lslot" + (sk ? "" : " sel");
      d.innerHTML = '<div class="lb">' + SLOT_LAB[slot] + ' · ' + (slot === "basic" ? "普攻" : slot === "ult" ? "大招" : "技能" + (slot === "skill1" ? "1" : "2")) + '</div>' +
        '<div class="ls">' + (sk ? sk.icon + " " + sk.name : "（空）") + '</div>' +
        '<div class="lk">' + (sk ? (sk.kind === "ult" ? "需满能量" : "CD " + sk.cd + "s") : "未装配") + '</div>';
      lb.appendChild(d);
    });

    const wrap = $("skillShop");
    wrap.innerHTML = "";
    LD.skillsBy(kind).forEach(s => {
      const owned = P.ownsSkill(s.id), slot = P.findSlotOf(s.id);
      const d = document.createElement("div");
      d.className = "item" + (owned ? " own" : "") + (slot ? " eq" : "") + (!owned && P.d.coins >= s.price ? " can" : "");
      let acts = "";
      if (owned && s.kind === "skill") {
        ["skill1", "skill2"].forEach(k => {
          acts += '<button class="btn sm" data-eq="' + k + '" style="padding:3px 9px;font-size:10px">装配 ' + SLOT_LAB[k] + '</button>';
        });
      }
      if (owned && s.kind !== "skill") {
        const k = s.kind === "basic" ? "basic" : "ult";
        acts += '<button class="btn sm" data-eq="' + k + '" style="padding:3px 9px;font-size:10px">装配 ' + SLOT_LAB[k] + '</button>';
      }
      if (slot) acts += '<button class="btn sm ghost" data-un="' + s.id + '" style="padding:3px 9px;font-size:10px">卸下</button>';
      d.innerHTML =
        '<div style="font-size:22px;margin:4px 0">' + s.icon + '</div>' +
        '<div class="nm">' + s.name + '</div>' +
        '<div style="font-size:10px;color:#8fa0c8;margin-top:3px;line-height:1.5">' + s.tags.join(" · ") + '</div>' +
        '<div class="pr">' + (owned ? (slot ? "已装配 " + SLOT_LAB[slot] : "点击装配") : "🪙 " + s.price) + '</div>' +
        (s.dmg ? '<div style="font-size:10px;color:#fb923c">伤害 ' + s.dmg + (s.cd ? ' · CD ' + s.cd + 's' : '') + '</div>' : (s.cd ? '<div style="font-size:10px;color:#8fa0c8">CD ' + s.cd + 's</div>' : '')) +
        '<div style="display:flex;gap:4px;justify-content:center;margin-top:6px;flex-wrap:wrap">' + acts + '</div>' +
        (owned ? '<div class="st' + (slot ? ' eq' : '') + '">' + (slot ? "★" : "✓") + '</div>' : '');
      d.title = s.desc;
      d.onclick = (ev) => {
        if (ev.target.dataset && ev.target.dataset.eq) {
          const k = ev.target.dataset.eq;
          const r = P.equipSkill(k, s.id);
          if (r.ok) { Audio2.ui(); UI.toast("「" + s.name + "」已装配到 " + SLOT_LAB[k]); UI.renderSkill(); }
          else UI.toast(r.why);
          return;
        }
        if (ev.target.dataset && ev.target.dataset.un) {
          const found = P.findSlotOf(ev.target.dataset.un);
          if (found) { P.equipSkill(found, null); Audio2.ui(); UI.toast("已卸下「" + s.name + "」"); UI.renderSkill(); }
          return;
        }
        Audio2.ui();
        if (!owned) { if (doBuy(P.buySkill(s.id), s.name)) UI.renderSkill(); return; }
        // 已拥有：自动装到第一个空槽
        const slotKey = s.kind === "basic" ? "basic" : s.kind === "ult" ? "ult" : (!P.d.loadout.skill1 ? "skill1" : !P.d.loadout.skill2 ? "skill2" : "skill1");
        const r = P.equipSkill(slotKey, s.id);
        if (r.ok) { UI.toast("「" + s.name + "」已装配到 " + SLOT_LAB[slotKey]); UI.renderSkill(); }
        else UI.toast(r.why);
      };
      wrap.appendChild(d);
    });
    document.querySelectorAll("#skillTabs .tab").forEach(t => t.classList.toggle("on", t.dataset.kind === kind));
  };

  /* ==========================================================
   *  我的配装
   * ========================================================== */
  UI.renderLoad = function () {
    V.heroPreview($("loadPv"), P.look(), 0);
    const rows = [
      ["头部", LD.part(P.d.equip.head)],
      ["上身", LD.part(P.d.equip.upper)],
      ["下身", LD.part(P.d.equip.lower)]
    ].map(([k, p]) => '<div style="margin:5px 0">' + k + '：<b>' + (p ? p.name : "-") + '</b></div>').join("");
    const sk = ["basic", "skill1", "skill2", "ult"].map(slot => {
      const s = LD.skill(P.d.loadout[slot]);
      return '<div style="margin:5px 0">' + SLOT_LAB[slot] + ' ' + (slot === "basic" ? "普攻" : slot === "ult" ? "大招" : "技能" + (slot === "skill1" ? "1" : "2")) +
        '：<b>' + (s ? s.icon + " " + s.name : "（空）") + '</b>' +
        (s ? '<span style="color:#8fa0c8;font-size:11.5px"> — ' + s.desc + '</span>' : '') + '</div>';
    }).join("");
    const prog = LD.LEVELS.map(l =>
      '<div style="margin:5px 0">' + l.icon + ' ' + l.name + '：普通 ' + (P.cleared(l.id, "normal") ? "✅" : "⬜") +
      ' / 困难 ' + (P.cleared(l.id, "hard") ? "✅" : "⬜") + '</div>').join("");
    $("loadInfo").innerHTML =
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px">外观</div>' + rows +
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px;margin-top:12px">技能</div>' + sk +
      '<div style="font-size:13px;color:#7fe6f7;letter-spacing:1px;margin-top:12px">关卡进度</div>' + prog;
  };

  /* ==========================================================
   *  关卡
   * ========================================================== */
  UI.renderLevels = function () {
    const g = $("levelGrid");
    g.innerHTML = "";
    LD.LEVELS.forEach(l => {
      ["normal", "hard"].forEach(k => {
        const d = LD.DIFF[k], done = P.cleared(l.id, k);
        const c = document.createElement("div");
        c.className = "card";
        c.innerHTML =
          '<div class="t">' + l.icon + ' ' + l.name + '</div>' +
          '<div class="d">' + l.desc + '</div>' +
          '<div class="d" style="margin-top:6px;color:' + d.color + '">' +
            '奖励 🪙 ' + d.reward + ' · 怪物血量 ×' + d.hpM + ' · 伤害 ×' + d.dmgM + ' · 频率 ×' + d.rateM + '</div>' +
          '<div class="badge' + (k === "hard" ? " hard" : "") + '">' + d.name + (done ? " · 已通关" : "") + '</div>';
        c.onclick = () => { Audio2.ui(); UI.startDragon(l, d); };
        g.appendChild(c);
      });
    });
  };

  /* ==========================================================
   *  帮助
   * ========================================================== */
  UI.renderHelp = function () {
    $("helpBody").innerHTML = [
      '<h3>操作</h3>',
      '<ul>',
      '<li><span class="k">W</span><span class="k">A</span><span class="k">S</span><span class="k">D</span> 或方向键：四向移动；<b>快速双击同一方向键</b>可短距离闪避（无无敌帧，冷却 2.5 秒，与普攻共享冷却——闪避后普攻同样要等 2.5 秒）</li>',
      '<li><span class="k">J</span> 普攻　<span class="k">K</span> 技能 1　<span class="k">L</span> 技能 2　<span class="k">O</span> 大招　<span class="k">V</span> 切换索敌目标</li>',
      '<li><span class="k">M</span> 静音　<span class="k">Esc</span> 返回主菜单</li>',
      '<li>技能槽位可以在「技能商店」里自由更换，最多 1 个普攻 + 2 个技能 + 1 个大招。<b>格挡</b>属于普攻分类，装在 J 槽。</li>',
      '</ul>',
      '<h3>索敌机制</h3>',
      '<ul>',
      '<li>当前锁定的对手头顶会有<b>黄色三角标记</b>，按 <span class="k">V</span> 在存活的敌人之间循环切换（Shift+V 反向）。</li>',
      '<li>追踪类与需要瞄准的技能（远程普攻、瞬身等）会<b>优先朝锁定的目标</b>出手；锁定目标倒下后自动回退到最近的敌人。</li>',
      '</ul>',
      '<h3>能量与大招</h3>',
      '<ul>',
      '<li>大招统一需要 <b>能量满 150</b> 才能释放。能量条在血量条下方。</li>',
      '<li>回能方式：<b>命中敌人 +12</b>、<b>被击中 +10</b>、以及每秒 <b>+2.2</b> 的自然回复。</li>',
      '<li>任何角色（包括巨龙）释放大招时都会<b>全局暂停并给出局部特写</b>，技能名逐字出现——这是预警，注意躲。</li>',
      '</ul>',
      '<h3>战斗技巧</h3>',
      '<ul>',
      '<li><b>格挡</b>：空放或挡下普攻 → 冷却 2 秒；挡下技能或大招 → 冷却 8 秒。代价不同，读招要准。</li>',
      '<li>格挡还能把飞来的远程攻击<b>原路反弹</b>，反弹后伤害更高。</li>',
      '<li>位移类技能冲刺过程中<b>无敌</b>，可以穿过弹幕。</li>',
      '<li>被击中会打断「冥思」，被打断时自己会眩晕 1 秒，谨慎使用。</li>',
      '</ul>',
      '<h3>关卡与金币</h3>',
      '<ul>',
      '<li>单人「巨龙格斗」为关卡制，每关有普通 / 困难两档。困难模式怪物血更厚、更疼、出手更频繁。</li>',
      '<li>单人「巨龙格斗」普通通关 <b>+4 金币</b>，困难通关 <b>+10 金币</b>；'
      + '<b>人机对战</b>胜利普通 <b>+6 金币</b>、困难 <b>+12 金币</b>（三局两胜整局结算）。</li>',
      '<li>部件（头 / 上身 / 下身）与普攻 / 技能均 <b>6 金币</b>，大招 <b>10 金币</b>。</li>',
      '</ul>',
      '<h3>三种对战模式（单人与联机都可选）</h3>',
      '<ul>',
      '<li><b>乱斗模式</b>：所有人互相为敌，最后站着的赢下回合。</li>',
      '<li><b>阵营模式</b>：红黄蓝绿四队，同队之间互不造成伤害（名字前有队伍色点），最后只剩一个阵营时获胜；全同阵营不能开局。</li>',
      '<li><b>霸主争霸</b>：巨龙同场混战。击败巨龙会爆出<b>能量石</b>并飞向随机位置，第一个抢到的人成为<b>霸主</b>：血量上限与当前血量 ×1.5、头顶加皇冠，其他人机的仇恨会转向霸主；霸主阵亡后石头掉回场上重新争夺。</li>',
      '<li>单人「勇者格斗」就是角色卡房间：第一张卡是你（可直接换装扮 / 技能），后面的人机卡可增删（最多 3 个）、可选难度（木桩 / 普通 / 困难）与配装。</li>',
      '</ul>',
      '<h3>联机方法（2-4 人）</h3>',
      '<ul>',
      '<li>1. 所有电脑连同一个 Wi-Fi / 手机热点。</li>',
      '<li>2. 用 exe 启动的话服务器已经开好了；如提示防火墙，勾选「专用」和「公用」并允许。</li>',
      '<li>3. 房主：主菜单 → 多人游戏 → 创建房间，拿到 4 位房号。</li>',
      '<li>4. 朋友：浏览器打开房主的地址（形如 <b>http://192.168.x.x:8123</b>）→ 多人游戏 → 加入房间 → 输入房号。</li>',
      '<li>5. 房间准备阶段所有人都是角色卡：可以换装扮 / 技能，房主可以增删人机（最多 3 个）并选择模式，2-4 人随时开局。</li>',
      '<li>⚠️ 朋友不要开服务器，只开房主那一台；连不上先查防火墙与路由器「AP 隔离」。</li>',
      '</ul>'
    ].join("");
    UI.coins();
  };

  /* ==========================================================
   *  人机对战设置（旧面板已由 75_room.js 的角色卡房间取代，
   *  这里只保留 startDuel 兜底所需的最小状态）
   * ========================================================== */
  const DuelSetup = UI.duel = { level: "normal", loadout: null };
  function ensureAiLoadout() { if (!DuelSetup.loadout) DuelSetup.loadout = LD.AI.randomLoadout(); return DuelSetup.loadout; }

  /* ==========================================================
   *  HUD
   * ========================================================== */
  const slotEls = [];
  function buildHud() {
    $("slots").innerHTML = "";
    slotEls.length = 0;
    ["basic", "skill1", "skill2", "ult"].forEach((slot, i) => {
      const d = document.createElement("div");
      d.className = "slot" + (slot === "ult" ? " big" : "");
      d.innerHTML = '<span class="kb">' + SLOT_LAB[slot] + '</span><span class="ic"></span><span class="nm"></span>' +
        '<span class="cd" style="display:none"></span><span class="en"></span>';
      $("slots").appendChild(d);
      slotEls.push({ slot, el: d, ic: d.querySelector(".ic"), nm: d.querySelector(".nm"), cd: d.querySelector(".cd"), en: d.querySelector(".en") });
    });
  }

  UI.updateHud = function () {
    const me = B.hero(B.mySide == null ? 0 : B.mySide) || B.hero(0);
    if (!me) return;
    const pb = $("pBars"), eb = $("eBars");
    pb.innerHTML = bar("HP", me.hp, me.maxHp, "hp") + bar("能量", me.energy, me.maxEnergy, "en" + (me.energy >= me.maxEnergy ? " full" : ""));
    /* 敌方：除自己以外的所有参战者（联机最多 3 个对手） */
    const foes = B.fighters.filter(x => x.side !== me.side);
    eb.innerHTML = foes.map(foe => {
      const tags = [];
      if (foe.kind === "dragon") {
        tags.push(foe.name + (foe.rageStage === 2 ? " · 狂暴" : foe.rageStage === 1 ? " · 暴怒" : ""));
      } else {
        if (B.rule === "team" && foe.team >= 0) tags.push(LD.TEAM_NAMES[foe.team]);
        if (foe.overlord) tags.push("👑 霸主");
        if (B.rule === "overlord" && B.stone && !B.stone.holder) tags.push("石头已掉落");
        if (foe.name && (B.mode === "net" || B.rule !== "brawl")) tags.push(foe.name);
        if (foe.dead) tags.push("已倒下");
      }
      const extra = tags.length ? '<div class="tag">' + tags.join(" · ") + '</div>' : "";
      return extra + bar("HP", foe.hp, foe.maxHp, "hp foe");
    }).join("");
    slotEls.forEach(s => {
      const id = me.loadout[s.slot], sk = LD.skill(id);
      if (!sk) {
        s.el.className = "slot empty" + (s.slot === "ult" ? " big" : "");
        s.ic.textContent = "—"; s.nm.textContent = "空槽位"; s.cd.style.display = "none"; s.en.style.transform = "scaleX(0)";
        return;
      }
      s.ic.textContent = sk.icon; s.nm.textContent = sk.name;
      const cdv = me.cd[s.slot];
      if (cdv > 0.05) { s.cd.style.display = "flex"; s.cd.textContent = cdv.toFixed(1); }
      else s.cd.style.display = "none";
      let cls = "slot" + (s.slot === "ult" ? " big" : "");
      if (sk.kind === "ult") {
        s.en.style.transform = "scaleX(" + (me.energy / me.maxEnergy) + ")";
        if (me.energy >= me.maxEnergy) cls += " ultready";
      } else {
        s.en.style.transform = "scaleX(0)";
        if (cdv <= 0.05) cls += " ready";
      }
      s.el.className = cls;
    });
  };

  function bar(lab, v, max, cls) {
    const p = Math.max(0, Math.min(1, v / max));
    return '<div class="barrow">' +
      '<span class="barlab">' + lab + '</span>' +
      '<div class="bartrack ' + cls + '"><div class="barfill" style="transform:scaleX(' + p + ')"></div>' +
      '<div class="bartxt">' + Math.ceil(v) + " / " + Math.round(max) + '</div></div></div>';
  }

  /* ==========================================================
   *  输入
   * ========================================================== */
  const keys = {};
  const ctrl = UI.ctrl = { mx: 0, my: 0, dodge: null, hold: { basic: false, skill1: false, skill2: false, ult: false }, press: { basic: false, skill1: false, skill2: false, ult: false } };
  const KEYMAP = {
    KeyJ: "basic", KeyK: "skill1", KeyL: "skill2", KeyO: "ult",
    Space: "skill2", ShiftLeft: "skill1", ShiftRight: "skill1"
  };
  // 双击方向键 → 闪避
  const DIRKEYS = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyS: [0, 1], ArrowDown: [0, 1], KeyD: [1, 0], ArrowRight: [1, 0]
  };
  const lastTap = {};

  UI.bindKeys = function () {
    const down = e => {
      const c = e.code;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(c) >= 0) e.preventDefault();
      if (keys[c]) return;
      keys[c] = true;
      if (c === "KeyM") { Audio2.muted = !Audio2.muted; $("btnMute").textContent = Audio2.muted ? "🔇 静音" : "🔊 音效"; return; }
      if (c === "Escape") { UI.quitGame(); return; }
      if (c === "KeyR" && B.state === "over") { UI.restart(); return; }
      const slot = KEYMAP[c];
      if (slot) { ctrl.press[slot] = true; ctrl.hold[slot] = true; }
      const dk = DIRKEYS[c];
      if (dk) {
        const now = performance.now();
        if (lastTap[c] && now - lastTap[c] < 280) { ctrl.dodge = { x: dk[0], y: dk[1] }; lastTap[c] = 0; }
        else lastTap[c] = now;
      }
      updateAxis();
    };
    const up = e => {
      const c = e.code; keys[c] = false;
      const slot = KEYMAP[c];
      if (slot) ctrl.hold[slot] = false;
      updateAxis();
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", () => { Object.keys(keys).forEach(k => keys[k] = false); updateAxis(); ctrl.hold.basic = ctrl.hold.skill1 = ctrl.hold.skill2 = ctrl.hold.ult = false; Object.keys(lastTap).forEach(k => lastTap[k] = 0); });
    function updateAxis() {
      let mx = 0, my = 0;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      if (keys.KeyW || keys.ArrowUp) my -= 1;
      if (keys.KeyS || keys.ArrowDown) my += 1;
      ctrl.mx = mx; ctrl.my = my;
    }
  };

  UI.clearCtrl = function () { ctrl.mx = ctrl.my = 0; ctrl.dodge = null; ["basic", "skill1", "skill2", "ult"].forEach(k => { ctrl.hold[k] = false; ctrl.press[k] = false; }); Object.keys(lastTap).forEach(k => lastTap[k] = 0); };

  /* ==========================================================
   *  开局
   * ========================================================== */
  function botLook() {
    /* 每局人机的皮肤随机搭配：头 / 上身 / 下身各从全目录随机抽一款 */
    const pick = part => { const a = LD.partsBy(part); return a[(Math.random() * a.length) | 0]; };
    const h = pick("head"), u = pick("upper"), l = pick("lower");
    return {
      head: { model: h.model, c1: h.c1, c2: h.c2, c3: h.c3 },
      upper: { c1: u.c1, c2: u.c2 },
      lower: { c1: l.c1, c2: l.c2 }
    };
  }

  UI.enterGame = function () {
    UI.clearCtrl();
    buildHud();
    $("hudVer").textContent = "v" + LD.VERSION;
    UI.show("game");
  };

  UI.startDragon = function (level, diff) {
    const hero = B.mkHero(0, { x: C.W * 0.26, y: C.H * 0.56, look: P.look(), loadout: P.d.loadout, name: "勇者", energy: 0 });
    hero.ctrl = ctrl;
    const dragon = B.mkDragon({ diff });
    B.setup({ mode: "dragon", diff, level, fighters: [hero, dragon], theme: { top: "#1a1226", bottom: "#08060f", grid: "rgba(251,113,133,.35)", moon: "rgba(251,146,60,.22)" } });
    B.onEnd = win => UI.endDragon(win, level, diff);
    UI.enterGame();
  };

  UI.startDuel = function () {
    const lo = ensureAiLoadout();
    const hero = B.mkHero(0, { x: C.W * 0.26, y: C.H * 0.56, look: P.look(), loadout: P.d.loadout, name: "勇者" });
    hero.ctrl = ctrl;
    const bot = B.mkHero(1, { x: C.W * 0.74, y: C.H * 0.56, look: botLook(), loadout: { basic: lo.basic, skill1: lo.skill1, skill2: lo.skill2, ult: lo.ult }, name: "电脑" });
    LD.AI.mkBot(bot, DuelSetup.level);
    B.setup({ mode: "duel", fighters: [hero, bot], theme: {} });
    B.roundT = 75;
    B.onEnd = win => UI.endDuel(win);
    UI.enterGame();
  };

  UI.endDragon = function (win, level, diff) {
    if (win) {
      const reward = diff.reward;
      const first = P.clear(level.id, diff.key, reward);
      Audio2.win();
      $("endTitle").textContent = "讨伐成功";
      $("endSub").innerHTML = "击败了 <b>" + level.name + "</b>（" + diff.name + "）<br>获得 <b style='color:#ffd98a'>🪙 " + reward + " 金币</b>" +
        (first ? "<br><span style='color:#7ff0c4'>首次通关该难度！</span>" : "") +
        "<br><span style='color:#8fa0c8'>当前金币：" + P.d.coins + "</span>";
    } else {
      Audio2.lose();
      $("endTitle").textContent = "挑战失败";
      $("endSub").innerHTML = "被 <b>" + level.name + "</b>（" + diff.name + "）击败了<br><span style='color:#8fa0c8'>" + level.tip + "</span>";
    }
    UI.show("ovEnd");
  };

  UI.endDuel = function (win) {
    /* 人机对战奖励：普通胜利 +6，困难胜利 +12（三局两胜整局结算一次） */
    const reward = win ? (DuelSetup.level === "hard" ? 12 : 6) : 0;
    if (win) {
      P.addCoins(reward);
      Audio2.win();
      $("endTitle").textContent = "对决胜利";
      $("endSub").innerHTML = "比分 " + B.score.join(" : ") +
        "<br>获得 <b style='color:#ffd98a'>🪙 " + reward + " 金币</b>（" +
        (DuelSetup.level === "hard" ? "困难" : "普通") + "难度）" +
        "<br><span style='color:#8fa0c8'>当前金币：" + P.d.coins + "</span>";
    } else {
      Audio2.lose();
      $("endTitle").textContent = "对决失败";
      $("endSub").innerHTML = "比分 " + B.score.join(" : ") + "<br><span style='color:#8fa0c8'>再战一局，胜利才有奖励（普通 6 / 困难 12）</span>";
    }
    UI.show("ovEnd");
  };

  UI.endNet = function (win) {
    const champ = B.fighters[B.matchWinner];
    const champName = champ ? (champ.name || "玩家" + (B.matchWinner + 1)) : "未知";
    if (win) { Audio2.win(); $("endTitle").textContent = "你赢了！"; }
    else { Audio2.lose(); $("endTitle").textContent = "你输了"; }
    $("endSub").innerHTML = "本局冠军：<b style='color:#ffd98a'>" + champName + "</b>" +
      "<br>比分 " + B.score.map((v, i) => ((B.fighters[i] && B.fighters[i].name) || "P" + (i + 1)) + " " + v).join(" · ") +
      "<br><span style='color:#8fa0c8'>" + (LD.Net.peerIn ? "对手仍在房间" : "对手已离开") + "</span>";
    UI.show("ovEnd");
  };

  UI.restart = function () {
    if (B.mode === "net") {
      if (LD.Net.isHost) UI.netHostStart();
      else { LD.Net.toPeer({ t: "again" }); UI.toast("已请求再战，等待房主开始…"); }
    }
    else if (B.mode === "dragon") UI.startDragon(B.level, B.diff);
    else if (UI.room && UI.room.bots.length) UI.roomStart();
    else UI.startDuel();
  };

  UI.quitGame = function () {
    if (B.state !== "idle" && B.state !== "over") {
      B.state = "over";
      if (B.mode === "net") LD.Net.toPeer({ t: "bye" });
    }
    B.fighters = []; B.projs = []; B.zones = [];
    LD.FX.clear(); LD.Cine.active = false;
    UI.show("ovMenu");
  };

  /* ==========================================================
   *  联机
   * ========================================================== */
  UI.startNetBattle = function (roster, rule, dragonDiff) {
    const N = LD.Net;
    LD.Net.buildNetBattle({
      isHost: N.isHost, mySide: N.mySide, roster: roster || null,
      rule: rule || "brawl", dragonDiff: dragonDiff || "normal"
    });
    B.onEnd = win => UI.endNet(win);
    UI.enterGame();
  };

  UI.bindNet = function () {
    const N = LD.Net;
    N.on("status", s => {
      if (UI.screen !== "ovMulti") return;
      const e = $("multiState");
      if (s.ok) e.innerHTML = '<span class="dot"></span> 服务器已连接，可以创建或加入房间';
      else if (s.why === "file") e.innerHTML = '⚠️ 当前是直接打开 HTML 文件，联机需要先启动服务器（双击「孤高旅斗.exe」或让房主开服）';
      else e.innerHTML = '<span class="dot off"></span> 服务器未连接，请确认已启动服务器';
    });
    N.on("created", code => {
      N.peersIn.length = 0; N.roster = {};
      UI.netRoom.rule = "brawl"; UI.netRoom.teams = {}; UI.netRoom.bots = []; UI.netRoom.players = [];
      UI.show("ovWait");
      UI.renderNetRoom();
      UI.toast("房间已创建，房号 " + code + "，把房号告诉朋友吧");
    });
    N.on("joined", () => {
      UI.toast("房间已加入，等待房主开始");
      UI.show("ovWait");
      UI.renderNetRoom();
    });
    N.on("err", msg => { Audio2.beep(200, 0.15, "square", 0.05); UI.toast(msg); });
    N.on("profile", () => { UI.renderNetRoom(); });
    N.on("room", d => { UI.applyNetRoom(d); });
    N.on("peerJoined", seat => {
      UI.renderNetRoom();
      UI.toast(N.isHost ? ("玩家 " + (seat + 1) + " 已加入，当前 " + (1 + N.peersIn.length) + "/4 人") : "对手已加入");
      LD.Net.sendProfile();
    });
    N.on("peerLeft", () => {
      UI.renderNetRoom();
      UI.toast("有玩家离开了");
      if (B.mode === "net" && B.state !== "over" && B.state !== "idle") { B.state = "over"; UI.endNet(false); }
    });
    N.on("start", d => { UI.startNetBattle(d && d.roster, d && d.rule, d && d.dragonDiff); });
    N.on("again", () => { if (LD.Net.isHost) UI.netHostStart(); });
    N.on("matchEnd", mw => { if (!LD.Net.isHost && B.mode === "net") { B.matchWinner = mw; UI.endNet(mw === LD.Net.mySide); } });
  };

  /* ==========================================================
   *  绑定
   * ========================================================== */
  UI.init = function () {
    this.bindKeys();
    this.bindNet();

    const go = (id, fn) => { const e = $(id); if (e) e.onclick = () => { Audio2.init(); Audio2.ui(); fn(); }; };
    document.querySelectorAll("[data-back]").forEach(e => {
      e.onclick = () => { Audio2.ui(); UI.show(UI.backTo && UI.backTo !== e.dataset.back ? UI.backTo : e.dataset.back); UI.backTo = null; };
    });

    go("mSolo", () => UI.show("ovSolo"));
    go("mMulti", () => { UI.show("ovMulti"); LD.Net.connect(); });
    go("mHelp", () => UI.show("ovHelp"));
    go("mSkin", () => UI.show("ovSkin"));
    go("mSkill", () => UI.show("ovSkill"));
    go("mLoad", () => UI.show("ovLoad"));

    go("sDrag", () => UI.show("ovLevels"));
    go("sDuel", () => { UI.show("ovDuelSetup"); UI.renderRoom(); });

    go("btnCreate", () => { LD.Net.connect(); LD.Net.create(); });
    go("btnGoJoin", () => { LD.Net.connect(); UI.show("ovJoin"); const ci = $("codeInput"); if (ci) { ci.value = ""; ci.focus(); } });
    go("btnJoin", () => {
      const v = ($("codeInput").value || "").replace(/\D/g, "");
      if (v.length !== 4) { UI.toast("请输入 4 位房号"); return; }
      LD.Net.connect(); LD.Net.join(v);
    });
    go("btnLeaveWait", () => { LD.Net.leave(); UI.show("ovMulti"); });

    document.querySelectorAll("#skinTabs .tab").forEach(t => {
      t.onclick = () => { UI.skinTab = t.dataset.part; Audio2.ui(); UI.renderSkin(); };
    });
    document.querySelectorAll("#skillTabs .tab").forEach(t => {
      t.onclick = () => { UI.skillTab = t.dataset.kind; Audio2.ui(); UI.renderSkill(); };
    });

    go("btnCheat", () => {
      P.cheatCoins();
      Audio2.buy();
      UI.toast("作弊 +10 金币 → 当前 " + P.d.coins, true);
      UI.renderHelp();
    });

    go("btnAgain", () => UI.restart());
    go("btnEndMenu", () => UI.quitGame());
    go("btnQuit", () => UI.quitGame());
    go("btnMute", () => { Audio2.muted = !Audio2.muted; $("btnMute").textContent = Audio2.muted ? "🔇 静音" : "🔊 音效"; });

    $("codeInput").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
    $("codeInput").addEventListener("keydown", e => { if (e.key === "Enter") $("btnJoin").onclick(); });

    $("menuVer").textContent = "v" + LD.VERSION + " · 一人一剑，向死而生";
    $("hudVer").textContent = "v" + LD.VERSION;
    this.show("ovMenu");
  };
})(window.LD = window.LD || {});
