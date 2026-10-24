/* ============================================================
 *  75_room.js — 开房间式准备界面（角色卡 / 模式 / 阵营 / 人机）
 * ============================================================
 *  单人对决与多人模式的准备阶段都用同一套「角色卡」：
 *    · 第一张卡永远是玩家自己（可在这里直接换装扮、换技能）
 *    · 后面的卡是人机 / 其他玩家（展示外貌与技能）
 *    · 支持增删人机、选择人机难度与技能、选择对战模式与阵营
 *  ============================================================ */
(function (LD) {
  "use strict";
  const UI = LD.UI, P = LD.Profile, A = LD.Audio, B = LD.Battle;

  const LEVELS = [
    { id: "easy", name: "木桩" },
    { id: "normal", name: "普通" },
    { id: "hard", name: "困难" }
  ];
  const SLOTS = ["basic", "skill1", "skill2", "ult"];
  const SLOT_LAB = { basic: "J", skill1: "K", skill2: "L", ult: "O" };

  /* 复制到剪贴板：http 非安全域下 navigator.clipboard 可能不存在，
     所以要有一条 execCommand 兜底路径（局域网联机常见） */
  function copyText(txt) {
    const ok = () => UI.toast("已复制：" + txt, true);
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const done = document.execCommand("copy");
        document.body.removeChild(ta);
        if (done) ok(); else UI.toast(txt);
      } catch (e) { UI.toast(txt); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(ok, fallback);
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    fallback();
  }

  function botLook() {
    /* v3.5：统一走 LD.randomLook（图片皮肤带 img），避免人机缺头 / 缺裤子 */
    return LD.randomLook();
  }

  /* 单人对决房间状态 */
  const room = UI.room = {
    rule: "brawl",
    myTeam: -1,
    mods: [],                    // v2.6 规则修饰符（可叠加）
    matchT: 120,                 // 对局时间（60 / 120 / 180，限时模式共用）
    map: LD.mapCfg({ preset: "random", seed: (Math.random() * 1e9) | 0 }),
    bots: []                     // { level, loadout, look }
  };

  /* 对局时间：限时模式共用；v3.1 房间界面简化，收进小弹窗 */
  function matchBarHtml(sel, who) {
    const times = (LD.MATCH && LD.MATCH.times) || [60, 120, 180];
    const attr = who === "net" ? "data-nmt" : "data-mt";
    return '<div class="sub" style="margin:2px 0 6px">对局时间</div>' +
      '<div class="lvtabs" style="justify-content:center;margin-bottom:8px">' +
      times.map(t => '<button class="lv lvbig' + (sel === t ? " sel" : "") + '" ' + attr + '="' + t + '">' + t + ' 秒</button>').join("") +
      '</div>';
  }

  /* v3.1 房间简化：对局时间 / 地图各为一个按钮，点开小弹窗编辑；说明全部悬停提示 */
  function settingBtnsHtml(r, who) {
    /* v3.7 塔防：时长与地图都由模式固定，不给按钮，避免误以为能改 */
    if (r.rule === "tower") {
      return '<div class="setrow"><span class="sub" style="line-height:30px">塔防对战固定：无时限 · 专用窄长地图（2800 × 600）· 红蓝两队（人数不限）</span></div>';
    }
    const attr = who === "net" ? "data-nset" : "data-lset";
    const p = LD.mapPreset((r.map && r.map.preset) || "random");
    return '<div class="setrow">' +
      '<button class="setbtn" ' + attr + '="time" title="对局时间：仅经典乱斗 / 阵营 / 追猎 / 热身使用，其余模式由规则自定（详见游戏帮助）">⏱ ' + (r.matchT || 120) + ' 秒</button>' +
      '<button class="setbtn" ' + attr + '="map" title="地图预设与各类地形数量，滑条拉到 0 表示不生成（详见游戏帮助）">🗺 ' + p.icon + " " + p.name + '</button>' +
      '</div>';
  }
  function modalHtml(id, title, body) {
    return '<div class="mmodal hide" id="' + id + '"><div class="mbox">' +
      '<div class="mhead">' + title + '<span class="mclose" data-mclose>✕</span></div>' +
      body + '</div></div>';
  }
  function bindModals(host, who) {
    const attr = who === "net" ? "data-nset" : "data-lset";
    host.querySelectorAll("[" + attr + "]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const m = host.querySelector(el.getAttribute(attr) === "time" ? "#timeModal" : "#mapModal");
        if (m) m.classList.remove("hide");
      };
    });
    host.querySelectorAll("[data-mclose]").forEach(el => {
      el.onclick = () => { const m = el.closest(".mmodal"); if (m) m.classList.add("hide"); };
    });
    host.querySelectorAll(".mmodal").forEach(m => {
      m.addEventListener("click", e => { if (e.target === m) m.classList.add("hide"); });
    });
  }
  /* 弹窗内的选择会触发重渲染，渲染后把地图弹窗重新打开（保持编辑上下文） */
  function reopenMapModal(who) {
    const m = document.getElementById("mapModal");
    if (m) m.classList.remove("hide");
  }

  /* ---------------- v3.0 地图配置 ---------------- */
  /* 全部随机：数量也随机；位置 / 材质每局重新抽（seed 在开局时刷新） */
  function randomCounts() {
    const r = n => Math.floor(Math.random() * (n + 1));
    return { solid: 2 + r(4), breakable: r(4), pushable: r(4), fence: r(4) };
  }
  function randomGround() {
    const list = LD.TERRAIN.grounds;
    return list[(Math.random() * list.length) | 0].id;
  }
  function newMapCfg(presetId, base) {
    const p = LD.mapPreset(presetId || "random");
    const src = {
      preset: p.id,
      counts: p.random ? randomCounts() : p.counts,
      ground: p.ground || (p.random ? randomGround() : (base && base.ground) || "grass"),
      seed: (Math.random() * 1e9) | 0
    };
    return LD.mapCfg(src);
  }
  UI.newMapCfg = newMapCfg;

  /** 房间里的地图配置面板：预设按钮 + 四条滑条 */
  function mapCfgHtml(cfg, who) {
    const p = LD.mapPreset(cfg.preset);
    const aP = who === "net" ? "data-nmp" : "data-mp";
    const aS = who === "net" ? "data-nms" : "data-ms";
    const presetBar = '<div class="maprow">' + LD.MAPS.presets.map(x =>
      '<button class="mapchip' + (x.id === cfg.preset ? " sel" : "") + '" ' + aP + '="' + x.id + '" title="' + x.desc + '">' +
      x.icon + " " + x.name + '</button>').join("") + '</div>';
    const sliders = '<div class="mapsliders">' + LD.MAPS.sliders.map(sl =>
      '<label class="msrow" title="' + sl.hint + '"><span>' + sl.name + '</span>' +
      '<input type="range" min="0" max="' + LD.MAPS.sliderMax + '" step="1" value="' + (cfg.counts[sl.key] || 0) + '" ' + aS + '="' + sl.key + '">' +
      '<b>' + (cfg.counts[sl.key] || 0) + '</b></label>').join("") + '</div>';
    return '<div class="mapbox">' +
      '<div class="sub" style="margin:0 0 4px">' + p.icon + " " + p.name + '</div>' +
      presetBar + sliders +
      '</div>';
  }

  /** 只读摘要（联机客机） */
  function mapCfgSummary(cfg) {
    const p = LD.mapPreset(cfg.preset);
    const c = cfg.counts || {};
    return '<div class="hint">地图：' + p.icon + " " + p.name +
      '　实心 ' + (c.solid || 0) + ' · 可破坏 ' + (c.breakable || 0) +
      ' · 可推动 ' + (c.pushable || 0) + ' · 围栏 ' + (c.fence || 0) + '（房主设定）</div>';
  }

  /** 开局用的地图配置：每局刷新种子，保证位置随机；联机由房主下发 */
  UI.mapCfgForStart = function (base) {
    const c = LD.mapCfg(base || room.map);
    c.seed = (Math.random() * 1e9) | 0;
    return c;
  };

  /* v2.6 修饰符选择条 */
  function modsBarHtml(sel) {
    return '<div class="rulebar">' + LD.MODS.map(m =>
      '<button class="rule' + (sel.indexOf(m.id) >= 0 ? " sel" : "") + '" data-mod="' + m.id + '" title="' + m.desc + '"><b>' + m.icon + " " + m.name + '</b></button>'
    ).join("") + '</div>';
  }

  /* 玩家自己的阵营（未选时按座位给默认阵营） */
  function myTeam() { return room.myTeam; }

  /** 统计已占用的阵营，用于「不能全同阵营」校验 */
  function teamsUsed(list) {              // list: [{team}]
    const s = {};
    list.forEach(x => { if (x.team >= 0) s[x.team] = 1; });
    return Object.keys(s).length;
  }

  function hardLevelOf(bots) {
    if (bots.some(b => b.level === "hard")) return "hard";
    if (bots.some(b => b.level === "normal")) return "normal";
    return "easy";
  }

  /* ---------------- 卡片渲染 ---------------- */
  /* v3.9 塔防 / 双阵营：2 队时统一红蓝，不能沿用四队配色里的黄色 */
  const TEAM2_COLORS = ["#f87171", "#60a5fa"];
  /* 只有红蓝两队的规则：塔防 / 占点争夺 / 护送情报箱（房间卡片与开局分队共用） */
  const isTwoTeam = (ruleId) => ruleId === "tower" || ruleId === "escort" || ruleId === "capture";
  const teamColorOf = (t, ruleId) => (isTwoTeam(ruleId) && t != null && t >= 0 ? TEAM2_COLORS[t > 0 ? 1 : 0] : LD.TEAM_COLORS[t]);

  function teamBar(sel, who, n) {
    /* v3.8 塔防只有红 / 蓝两队 */
    const cnt = n || 4;
    const names = cnt === 2 ? ["红队", "蓝队"] : LD.TEAM_NAMES;
    const colors = cnt === 2 ? TEAM2_COLORS.slice(0, cnt) : LD.TEAM_COLORS.slice(0, cnt);
    return '<div class="teamrow">' + colors.map((c, i) =>
      '<button class="tchip' + (sel === i ? " sel" : "") + '" data-team="' + i + '" data-twho="' + who + '" style="--tc:' + c + '">' +
      '<i style="background:' + c + '"></i>' + names[i] + '</button>').join("") + '</div>';
  }

  function teamTag(t, ruleId) {
    if (t == null || t < 0) return "";
    return '<i class="ttag" style="background:' + teamColorOf(t, ruleId) + '"></i>';
  }

  function skillSelect(attr, ids, val) {
    return '<select class="mini" ' + attr + '>' +
      ids.map(id => { const s = LD.skill(id); if (!s) return ""; return '<option value="' + id + '"' + (id === val ? " selected" : "") + '>' + s.icon + " " + s.name + '</option>'; }).join("") +
      '</select>';
  }

  function cardHtml(idx, data, opts) {
    /* opts: { kind: "me"|"bot"|"player", team, teamSel, level, loadout, name, rule } */
    const k = opts.kind;
    const ruleId = opts.rule || room.rule;
    const teamMode = ruleId === "team" || isTwoTeam(ruleId);
    const badge = k === "me" ? '<span class="cb me">你</span>'
      : k === "bot" ? '<span class="cb bot">人机</span>'
      : '<span class="cb p">玩家</span>';
    let body = "";
    if (k === "bot") {
      body += '<div class="crow"><span class="cl">难度</span>' +
        '<div class="lvtabs">' + LEVELS.map(l =>
          '<button class="lv' + (opts.level === l.id ? " sel" : "") + '" data-blv="' + idx + '" data-lv="' + l.id + '">' + l.name + '</button>').join("") + '</div></div>';
      body += '<div class="crow"><span class="cl">技能</span><div class="skgrid">' +
        SLOTS.map(slot => {
          const ids = slot === "basic" ? LD.AI.ALL_BASIC() : slot === "ult" ? LD.AI.ALL_ULT() : LD.AI.ALL_SKILL();
          return '<span class="ski"><span class="tk">' + SLOT_LAB[slot] + '</span>' +
            skillSelect('data-bsk="' + idx + '|' + slot + '"', ids, opts.loadout[slot]) + '</span>';
        }).join("") + '</div></div>';
      body += '<div class="crow"><button class="btn sm ghost" data-brnd="' + idx + '">随机配装</button>' +
        '<button class="btn sm ghost" data-bdel="' + idx + '">删除</button></div>';
    } else if (k === "me") {
      body += '<div class="crow"><button class="btn sm" data-open="ovSkin">装扮</button>' +
        '<button class="btn sm" data-open="ovSkill">技能</button><button class="btn sm ghost" data-open="ovLoad">总览</button></div>';
    } else {
      body += '<div class="crow sktext">' + SLOTS.map(slot => {
        const s = LD.skill(opts.loadout && opts.loadout[slot]);
        return '<span>' + SLOT_LAB[slot] + ' ' + (s ? s.icon : "—") + '</span>';
      }).join("") + '</div>';
    }
    if (teamMode && opts.teamSel) body += teamBar(opts.team, opts.twho || "me", isTwoTeam(ruleId) ? 2 : 4);
    return '<div class="pcard' + (k === "me" ? " mine" : "") + '">' +
      '<canvas class="pv" width="112" height="126"></canvas>' + badge +
      '<div class="pn">' + (teamMode ? teamTag(opts.team, ruleId) : "") + (opts.name || "玩家") + '</div>' + body + '</div>';
  }

  function drawPreviews(host, list) {
    const cvs = host.querySelectorAll("canvas.pv");
    list.forEach((it, i) => {
      const cv = cvs[i]; if (!cv) return;
      try { LD.View.heroPreview(cv, it.look, 0); } catch (e) {}
    });
  }

  /* ---------------- 单人对决房间 ---------------- */
  /* v4.12 模式分组：战斗模式 / 娱乐模式各占一行。
   * 娱乐模式（碰碰车、烫手山芋 + 本批六个新玩法）单独成组，
   * 否则它们会被淹没在一长排战斗模式里，而这批玩法的定位本来就完全不同。 */
  function ruleBarHtml(sel, exclude, attr, disabled) {
    const attrName = attr || "rule";
    return [["战斗模式", "combat"], ["娱乐模式", "casual"]].map(pair => {
      const list = (LD.rulesBy ? LD.rulesBy(pair[1]) : []).filter(r => !exclude || exclude.indexOf(r.id) < 0);
      if (!list.length) return "";
      return '<div class="sub" style="margin:2px 0 4px">' + pair[0] + '</div>' +
        '<div class="rulebar">' + list.map(r =>
          '<button class="rule' + (sel === r.id ? " sel" : "") + '" data-' + attrName + '="' + r.id + '"' +
          (disabled ? " disabled" : "") + ' title="' + r.desc + '"><b>' + r.icon + " " + r.name + '</b></button>').join("") +
        '</div>';
    }).join("");
  }

  UI.renderRoom = function () {
    const host = document.getElementById("roomBody");
    if (!host) return;
    // 首次进入给两张人机卡
    if (!room.bots.length) {
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      if (room.myTeam < 0) room.myTeam = 0;
    }
    const ruleBar = ruleBarHtml(room.rule, ["relay"]);   // 车轮战仅本地面板
    const modsBar = '<div class="sub" style="margin:2px 0 6px">规则修饰符（可多选叠加）</div>' + modsBarHtml(room.mods);
    const matchBar = settingBtnsHtml(room, "local")
      + modalHtml("timeModal", "对局时间", matchBarHtml(room.matchT, "local"))
      + modalHtml("mapModal", "地图配置", mapCfgHtml(room.map, "local"));
    const cards = [cardHtml(0, null, { kind: "me", name: (P.d.name || "你"), look: P.look(), team: myTeam(), teamSel: true, twho: "me", level: null, loadout: P.d.loadout, rule: room.rule })]
      .concat(room.bots.map((bb, i) => cardHtml(i, null, { kind: "bot", name: "人机 " + (i + 1), look: bb.look, team: botTeam(i), teamSel: true, twho: "b" + i, level: bb.level, loadout: bb.loadout, rule: room.rule })));
    host.innerHTML =
      '<h2>创建房间 · 选择模式</h2>' + ruleBar + modsBar + matchBar +
      '<div class="cardgrid">' + cards.join("") +
      (room.bots.length < 5 ? '<div class="card add" id="roomAddBot">+<span>添加人机</span></div>' : '') +
      '</div>' +
      '<div class="roomfoot">' +
      '<div class="btnrow"><div class="back" data-back="ovMenu">‹ 返回</div>' +
      '<button class="btn" id="roomStart">开始对决</button></div></div>';

    const list = [{ look: P.look() }].concat(room.bots.map(bb => ({ look: bb.look })));
    drawPreviews(host, list);
    bindRoom(host);
  };

  /* 人机阵营：阵营模式下默认按顺序轮流分到 4 个阵营；房主点卡片上的队伍色可手动指定 */
  function botTeam(i) {
    /* v3.8 塔防 / v4.8 占点 / 护送：红蓝两队，默认与玩家交替分边（可手动改）。
     * v4.11 塔防解除人数限制：不再强制凑满 3v3，双方人数可以不对等、也可以不满三个。 */
    if (isTwoTeam(room.rule)) {
      const bb = room.bots[i];
      if (bb && bb.team != null && bb.team >= 0) return bb.team > 0 ? 1 : 0;
      const mine = room.myTeam === 1 ? 1 : 0;
      return i % 2 === 0 ? 1 - mine : mine;
    }
    if (room.rule !== "team") return -1;
    const bb = room.bots[i];
    if (bb && bb.team != null && bb.team >= 0) return bb.team;
    return (i + 1) % 4;
  }

  /* 动态生成的「返回」按钮要就地绑定（初始化时的那批只覆盖静态 DOM） */
  function bindBack(host) {
    host.querySelectorAll("[data-back]").forEach(e => {
      e.onclick = () => {
        A.ui();
        UI.show(UI.backTo && UI.backTo !== e.dataset.back ? UI.backTo : e.dataset.back);
        UI.backTo = null;
      };
    });
  }

  function bindRoom(host) {
    const q = (sel) => host.querySelectorAll(sel);
    bindBack(host);
    bindModals(host, "local");
    q("[data-rule]").forEach(el => {
      el.onclick = () => {
        A.ui();
        room.rule = el.dataset.rule;
        /* 从 4 队模式切到红蓝两队：把越界的旧选择收回蓝队，避免没有高亮 */
        if (isTwoTeam(room.rule) && room.myTeam > 1) room.myTeam = 1;
        UI.renderRoom();
      };
    });
    q("[data-mod]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const id = el.dataset.mod, i = room.mods.indexOf(id);
        if (i >= 0) room.mods.splice(i, 1); else room.mods.push(id);
        UI.renderRoom();
      };
    });
    q("[data-mt]").forEach(el => {
      el.onclick = () => { A.ui(); room.matchT = +el.dataset.mt; UI.renderRoom(); };
    });
    q("[data-mp]").forEach(el => {
      el.onclick = () => { A.ui(); room.map = newMapCfg(el.dataset.mp, room.map); UI.renderRoom(); reopenMapModal("local"); };
    });
    q("[data-ms]").forEach(el => {
      el.oninput = () => {
        const key = el.dataset.ms;
        room.map.counts[key] = Math.max(0, Math.min(LD.MAPS.sliderMax, +el.value || 0));
        const b = el.parentNode && el.parentNode.querySelector("b");
        if (b) b.textContent = room.map.counts[key];
      };
    });
    q("[data-open]").forEach(el => {
      el.onclick = () => { A.ui(); UI.backTo = "ovDuelSetup"; UI.show(el.dataset.open); };
    });
    q("[data-team]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const t = +el.dataset.team, who = el.dataset.twho || "me";
        if (who === "me") room.myTeam = t;
        else {
          const i = +String(who).slice(1);
          if (room.bots[i]) room.bots[i].team = t;
        }
        UI.renderRoom();
      };
    });
    q("[data-blv]").forEach(el => {
      el.onclick = () => { A.ui(); room.bots[+el.dataset.blv].level = el.dataset.lv; UI.renderRoom(); };
    });
    q("[data-brnd]").forEach(el => {
      el.onclick = () => { A.ui(); const i = +el.dataset.brnd; room.bots[i].loadout = LD.AI.randomLoadout(); room.bots[i].look = botLook(); UI.renderRoom(); };
    });
    q("[data-bdel]").forEach(el => {
      el.onclick = () => { A.ui(); room.bots.splice(+el.dataset.bdel, 1); UI.renderRoom(); };
    });
    q("[data-bsk]").forEach(el => {
      el.onchange = () => {
        const [i, slot] = el.dataset.bsk.split("|");
        const bb = room.bots[+i];
        bb.loadout[slot] = el.value;
        if (slot !== "basic" && slot !== "ult" && bb.loadout.skill1 === bb.loadout.skill2) {
          const all = LD.AI.ALL_SKILL();
          const other = slot === "skill1" ? "skill2" : "skill1";
          bb.loadout[other] = all.find(id => id !== el.value) || bb.loadout[other];
          UI.toast("两个技能槽不能相同，已自动调整");
        }
        A.ui();
      };
    });
    const add = host.querySelector("#roomAddBot");
    if (add) add.onclick = () => {
      A.ui();
      room.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook() });
      UI.renderRoom();
    };
    const st = host.querySelector("#roomStart");
    if (st) st.onclick = () => { A.ui(); UI.roomStart(); };
  }

  /* ---------------- 开打 ---------------- */
  UI.roomStart = function () {
    const two = isTwoTeam(room.rule);
    if (two && room.myTeam < 0) room.myTeam = 0;
    /* v4.11 塔防不再限制人数：不强制补齐到 3v3，玩家想 1v1 / 2v3 都行。 */
    /* v4.8 占点 / 护送：和阵营模式一样按房间选择分队，且红蓝两边都必须有人 */
    if (room.rule === "team" || (two && room.rule !== "tower")) {
      const all = [{ team: myTeam() }].concat(room.bots.map((bb, i) => ({ team: botTeam(i) })));
      if (teamsUsed(all) < 2) {
        UI.toast(two ? "红蓝两队都要有人才能开局" : "至少要有两个阵营才能开局");
        return;
      }
    }
    UI.duel.level = hardLevelOf(room.bots);
    const fighters = [];
    const me = B.mkHero(0, { x: 0, y: 0, look: P.look(), loadout: Object.assign({}, P.d.loadout), name: P.displayName() });
    me.ctrl = UI.ctrl;
    me.team = (room.rule === "team" || two) ? myTeam() : -1;
    fighters.push(me);
    room.bots.forEach((bb, i) => {
      const bot = B.mkHero(i + 1, { x: 0, y: 0, look: bb.look, loadout: Object.assign({}, bb.loadout), name: (bb.level === "easy" ? "木桩" : "人机 " + (i + 1)) });
      LD.AI.mkBot(bot, bb.level);
      bot.team = (room.rule === "team" || two) ? botTeam(i) : -1;
      fighters.push(bot);
    });
    /* v3.9 霸主争霸不再放巨龙：改由天降皇冠决定霸主归属（见 B.initCrown） */
    /* v3.8 塔防：按房间选的红/蓝分队。
     * v4.11 去掉了「自动平衡成 3v3」——现在双方人数可以不对等，也可以不满三个。 */
    let teams = null;
    if (two) teams = [myTeam()].concat(room.bots.map((bb, i) => botTeam(i)));
    B.setup({ mode: "duel", rule: room.rule, fighters, theme: {}, mods: room.mods.slice(),
      teams: teams || undefined,
      matchT: room.matchT || (LD.MATCH && LD.MATCH.def) || 120,
      mapCfg: UI.mapCfgForStart(room.map) });
    B.resetRound(false);                 // 按座位号摆位（最多 4 人），并设置对应规则的限时
    B.onEnd = win => UI.endDuel(win);
    UI.enterGame();
  };

  /* ---------------- 多人准备阶段（角色卡） ---------------- */
  UI.netRoom = { rule: "brawl", teams: {}, bots: [], players: [], mods: [], matchT: 120,
    map: LD.mapCfg({ preset: "random", seed: (Math.random() * 1e9) | 0 }) };

  /* 当前房里都有谁：房主按 peesIn 推导，客机用房主同步下来的 players */
  UI.netPlayers = function () {
    const N = LD.Net, R = UI.netRoom, P0 = LD.Profile;
    if (!N.isHost && R.players && R.players.length) {
      return R.players.map(p => ({
        side: p.side, mine: p.side === N.mySide, name: p.name, team: p.team == null ? -1 : p.team,
        look: p.side === N.mySide ? P0.look() : (p.look || (N.roster[p.side] && N.roster[p.side].look) || P0.look()),
        loadout: p.side === N.mySide ? P0.d.loadout : (p.loadout || (N.roster[p.side] && N.roster[p.side].loadout) || LD.DEFAULT_LOADOUT)
      }));
    }
    const seats = [0].concat(N.peersIn.slice().sort((a, b) => a - b));
    return seats.map(seat => {
      const r = seat === N.mySide ? null : N.roster[seat];
      return {
        side: seat, mine: seat === N.mySide,
        name: (r && r.name) || (seat === 0 ? "房主" : "玩家 " + (seat + 1)),
        look: (r && r.look) || P0.look(),
        loadout: (r && r.loadout) || P0.d.loadout,
        team: R.teams[seat] == null ? -1 : R.teams[seat]
      };
    });
  };

  /* 阵营模式下：玩家按座位轮流分阵营，人机接在玩家后面继续轮流分
   * v4.8 占点 / 护送只有红蓝两队，轮转基数改成 2（否则会出现 3 号队的高亮丢失） */
  function netBotTeam(i, offset) { return (offset + i) % (isTwoTeam(UI.netRoom.rule) ? 2 : 4); }

  function netTeamOf(players, i) {
    const R = UI.netRoom;
    const seat = players[i].side;
    const two = isTwoTeam(R.rule);
    if (R.teams[seat] == null) R.teams[seat] = i % (two ? 2 : 4);
    return two ? (R.teams[seat] > 0 ? 1 : 0) : R.teams[seat];
  }

  UI.setNetTeam = function (seat, team) { UI.netRoom.teams[seat] = team; UI.netPushRoom(); };

  /** 全部参战者的阵营数组，用于「不能全同阵营」校验 */
  function netAllTeams(players) {
    const R = UI.netRoom;
    return players.map((p, i) => ({ team: netTeamOf(players, i) }))
      .concat(R.bots.map((b, i) => ({ team: b.team == null ? netBotTeam(i, players.length) : b.team })));
  }

  UI.renderNetRoom = function () {
    const host = document.getElementById("netRoomBody");
    if (!host) return;
    const N = LD.Net, R = UI.netRoom, isHost = N.isHost;
    const players = UI.netPlayers();
    R.players = players;
    const netTwo = isTwoTeam(R.rule);
    /* 占点 / 护送也要给每个座位落到红蓝（否则开局前 R.teams 是空的） */
    if (R.rule === "team" || netTwo) players.forEach((p, i) => netTeamOf(players, i));

    /* v4.12 分组排布；车轮战 / 塔防仅本地面板。
     * 非房主时整排按钮 disabled（保留分组标题，房主选了什么一眼看得出来）。 */
    const ruleBar = ruleBarHtml(R.rule, ["relay", "tower"], "nrule", !isHost);

    const cards = players.map((p, i) => cardHtml(i, null, {
      kind: p.mine ? "me" : "player", name: p.name, look: p.look,
      team: (R.rule === "team" || netTwo) ? netTeamOf(players, i) : -1,
      teamSel: (R.rule === "team" || netTwo) && (p.mine || isHost), twho: p.mine ? "me" : "s" + p.side,
      loadout: p.loadout, rule: R.rule
    }));
    R.bots.forEach((bb, i) => {
      /* 注意：这里必须传 i 而不是 100+i —— cardHtml 会把 idx 写进 data-blv/data-bdel 等属性，
         绑定层直接用 +dataset 索引 R.bots，传 100+i 会导致删除 / 难度 / 技能全部失灵 */
      cards.push(cardHtml(i, null, {
        kind: isHost ? "bot" : "player", name: "人机 " + (i + 1), look: bb.look,
        team: (R.rule === "team" || netTwo)
          ? (bb.team == null || bb.team < 0 ? netBotTeam(i, players.length) : (netTwo && bb.team > 0 ? 1 : bb.team))
          : -1,
        teamSel: (R.rule === "team" || netTwo) && isHost, twho: "b" + i,
        level: bb.level, loadout: bb.loadout, rule: R.rule
      }));
    });
    const canAdd = isHost && R.bots.length < 5;
    const netModsBar = isHost
      ? '<div class="sub" style="margin:2px 0 6px">规则修饰符（房主可选，可多选叠加）</div>' + modsBarHtml(R.mods || [])
        + settingBtnsHtml(R, "net")
        + modalHtml("timeModal", "对局时间", matchBarHtml(R.matchT, "net"))
        + modalHtml("mapModal", "地图配置", mapCfgHtml(R.map || LD.mapCfg({}), "net"))
      : (R.mods && R.mods.length ? '<div class="hint">修饰符：' + R.mods.map(id => { const m = LD.MODS.find(x => x.id === id); return m ? m.icon + m.name : id; }).join("、") + '</div>' : "")
        + '<div class="hint">⏱ ' + (R.matchT || 120) + ' 秒 · 🗺 ' + LD.mapPreset((R.map && R.map.preset) || "random").name + '（房主设定）</div>'
        + mapCfgSummary(R.map || LD.mapCfg({}));
    const urls = N.lanUrls && N.lanUrls.length ? N.lanUrls : [location.origin];
    const addrList = '<div class="addrlist">' + urls.map(u =>
      '<div class="addritem"><span class="addrbox">' + u + '</span>' +
      '<button class="btn sm ghost" data-addr="' + u + '">复制</button></div>').join("") +
      (N.lanLoading || !N.lanUrls.length
        ? '<div class="hint" style="opacity:.7">正在读取本机局域网地址…</div>'
        : '') + '</div>';
    host.innerHTML =
      '<h2>房间准备 · ' + players.length + ' 名玩家' + (R.bots.length ? " + " + R.bots.length + " 个人机" : "") + '</h2>' + ruleBar + netModsBar +
      '<div class="cardgrid">' + cards.join("") +
      (canAdd ? '<div class="card add" id="netAddBot">+<span>添加人机</span></div>' : '') + '</div>' +
      '<div class="roomfoot">' +
      '<div class="addrwrap"><div class="hint">房号 <b>' + (N.room || "----") + '</b>　' +
      '把这个网址和房号发给朋友，他打开后输入房号即可加入（家用/公司网络一般选 192.168.x.x，拿不准就多发几个让朋友试）</div>' +
      addrList +
      '<div class="btnrow"><button class="btn sm ghost" id="netCopy">复制网址+房号</button>' +
      '<div class="back" data-back="ovMulti">‹ 返回大厅</div>' +
      (isHost ? '<button class="btn" id="netStart">开始对决</button>' : '<div class="hint">等房主开始…</div>') + '</div></div>' +
      '</div>';

    drawPreviews(host, players.concat(R.bots));
    bindNetRoom(host);
  };

  function bindNetRoom(host) {
    const R = UI.netRoom;
    bindBack(host);
    bindModals(host, "net");
    host.querySelectorAll("[data-nrule]").forEach(el => {
      el.onclick = () => { A.ui(); R.rule = el.dataset.nrule; UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-mod]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const id = el.dataset.mod, i = (R.mods || []).indexOf(id);
        if (i >= 0) R.mods.splice(i, 1); else R.mods.push(id);
        UI.netPushRoom();          // 客机经房间同步看到修饰符变化
      };
    });
    host.querySelectorAll("[data-nmt]").forEach(el => {
      el.onclick = () => { A.ui(); R.matchT = +el.dataset.nmt; UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-nmp]").forEach(el => {
      el.onclick = () => { A.ui(); R.map = newMapCfg(el.dataset.nmp, R.map); UI.netPushRoom(); reopenMapModal("net"); };
    });
    host.querySelectorAll("[data-nms]").forEach(el => {
      el.oninput = () => {
        const key = el.dataset.nms;
        R.map = R.map || LD.mapCfg({});
        R.map.counts[key] = Math.max(0, Math.min(LD.MAPS.sliderMax, +el.value || 0));
        const b = el.parentNode && el.parentNode.querySelector("b");
        if (b) b.textContent = R.map.counts[key];
      };
    });
    host.querySelectorAll("[data-open]").forEach(el => {
      el.onclick = () => { A.ui(); UI.backTo = "ovWait"; UI.show(el.dataset.open); };
    });
    host.querySelectorAll("[data-team]").forEach(el => {
      el.onclick = () => {
        A.ui();
        const t = +el.dataset.team, who = el.dataset.twho || "me", N = LD.Net;
        if (who === "me") {
          if (N.isHost) { R.teams[N.mySide] = t; UI.netPushRoom(); }
          else { N.toPeer({ t: "rt", side: N.mySide, team: t }); R.teams[N.mySide] = t; UI.renderNetRoom(); }
        } else if (N.isHost) {
          /* 房主可以给任何玩家 / 人机指定阵营 */
          if (who[0] === "s") R.teams[+who.slice(1)] = t;
          else if (R.bots[+who.slice(1)]) R.bots[+who.slice(1)].team = t;
          UI.netPushRoom();
        }
      };
    });
    host.querySelectorAll("[data-blv]").forEach(el => {
      el.onclick = () => { A.ui(); R.bots[+el.dataset.blv].level = el.dataset.lv; UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-brnd]").forEach(el => {
      el.onclick = () => { A.ui(); const i = +el.dataset.brnd; R.bots[i].loadout = LD.AI.randomLoadout(); R.bots[i].look = botLook(); UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-bdel]").forEach(el => {
      el.onclick = () => { A.ui(); R.bots.splice(+el.dataset.bdel, 1); UI.netPushRoom(); };
    });
    host.querySelectorAll("[data-bsk]").forEach(el => {
      el.onchange = () => {
        const parts = el.dataset.bsk.split("|");
        const bb = R.bots[+parts[0]];
        if (!bb) return;
        bb.loadout[parts[1]] = el.value;
        A.ui(); UI.netPushRoom();
      };
    });
    const add = host.querySelector("#netAddBot");
    if (add) add.onclick = () => {
      A.ui();
      R.bots.push({ level: "normal", loadout: LD.AI.randomLoadout(), look: botLook(), team: -1 });
      UI.netPushRoom();
    };
    const st = host.querySelector("#netStart");
    if (st) st.onclick = () => { A.ui(); UI.netHostStart(); };
    host.querySelectorAll("[data-addr]").forEach(el => {
      el.onclick = () => { A.ui(); copyText(el.dataset.addr); };
    });
    const cp = host.querySelector("#netCopy");
    if (cp) cp.onclick = () => {
      const N = LD.Net;
      const url = (N.lanUrls && N.lanUrls[0]) || location.origin;
      const extra = N.lanUrls && N.lanUrls.length > 1
        ? "（另有 " + (N.lanUrls.length - 1) + " 个地址可用）" : "";
      copyText(url + "　房号 " + (N.room || "") + extra);
    };
  }

  /* 房主：把房间状态同步给所有挑战者（含人机、模式、阵营、名单） */
  UI.netPushRoom = function () {
    const N = LD.Net, R = UI.netRoom;
    if (!N.isHost) { UI.renderNetRoom(); return; }
    const players = UI.netPlayers();
    R.players = players;
    const teams = players.map((p, i) => ((R.rule === "team" || isTwoTeam(R.rule)) ? netTeamOf(players, i) : -1));
    N.toPeer({
      t: "room", rule: R.rule, bots: R.bots, mods: R.mods || [], matchT: R.matchT || 120,
      map: R.map || null,
      /* 外观与配装随房间状态一起下发：客机之间可能互相漏收 pl 消息，
         只靠花名册兜底会让某些客机眼里两个非房主穿成一模一样 */
      players: players.map((p, i) => ({ side: p.side, name: p.name, team: teams[i], look: p.look, loadout: p.loadout }))
    });
    UI.renderNetRoom();
  };

  /* 客机：收到房间状态后渲染 */
  UI.applyNetRoom = function (d) {
    const R = UI.netRoom, N = LD.Net, P0 = LD.Profile;
    R.rule = d.rule || R.rule;
    R.bots = d.bots || [];
    R.mods = d.mods || [];
    R.matchT = d.matchT || d.warmupT || R.matchT || 120;
    if (d.map) R.map = LD.mapCfg(d.map);
    R.players = (d.players || []).map(p => ({
      side: p.side, name: p.name, team: p.team == null ? -1 : p.team,
      /* 优先用房主下发的真实外观；旧版房间消息没有 look 时按花名册兜底 */
      look: p.look || (p.side === N.mySide ? P0.look() : (N.roster[p.side] && N.roster[p.side].look) || P0.look()),
      loadout: p.loadout || (p.side === N.mySide ? P0.d.loadout : (N.roster[p.side] && N.roster[p.side].loadout) || LD.DEFAULT_LOADOUT)
    }));
    UI.renderNetRoom();
  };

  /* 房主开打：把角色卡房间整理成花名册（玩家 + 人机）后广播并本地开局 */
  UI.netHostStart = function () {
    const N = LD.Net, R = UI.netRoom;
    if (!N.isHost) return;
    const players = UI.netPlayers();
    R.players = players;
    const netTwo = isTwoTeam(R.rule);
    if ((R.rule === "team" || netTwo) && teamsUsed(netAllTeams(players)) < 2) {
      UI.toast(netTwo ? "红蓝两队都要有人才能开局" : "至少要有两个阵营才能开局");
      return;
    }
    const roster = players.map((p, i) => ({
      look: p.look, loadout: Object.assign({}, p.loadout || {}), name: p.name,
      team: (R.rule === "team" || netTwo) ? netTeamOf(players, i) : -1
    })).concat(R.bots.map((b, i) => ({
      look: b.look, loadout: Object.assign({}, b.loadout), name: "人机 " + (i + 1),
      team: (R.rule === "team" || netTwo)
        ? (b.team == null || b.team < 0 ? netBotTeam(i, players.length) : (netTwo && b.team > 0 ? 1 : b.team))
        : -1,
      bot: true, level: b.level
    })));
    if (roster.length < 2) { UI.toast("至少需要两名参战者才能开局"); return; }
    const dragonDiff = R.bots.some(b => b.level === "hard") ? "hard" : "normal";
    const mods = (R.mods || []).slice();
    const matchT = R.matchT || 120;
    const mapCfg = UI.mapCfgForStart(R.map);
    N.toPeer({ t: "go", roster, rule: R.rule, dragonDiff, mods, matchT, mapCfg });
    UI.startNetBattle(roster, R.rule, dragonDiff, mods, matchT, mapCfg);
  };

  /* 局域网地址是异步取回来的，拿到后如果正停在房间界面就刷新一次把网址显示出来 */
  LD.Net.on("lan", () => {
    const body = document.getElementById("netRoomBody");
    if (body && body.querySelector(".addrlist") && UI.renderNetRoom) UI.renderNetRoom();
  });
})(window.LD = window.LD || {});
