/* 孤高旅斗 v4.33 人机搜刮补给箱测试
 * 覆盖：nearestFoeDist / 模式豁免 / 没人时动身开箱 / 有敌人时不动 /
 *       读条中敌人靠近就放弃 / 放弃后的冷却 / 走位停在正确距离
 */
const SB = require("./_sandbox.js");
const { fs, path, makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const sb = makeSandbox("ai-supply");
const LD = sb.LD, B = LD.Battle, AI = LD.AI;
LD.CONF.critRate = 0;
const BASE = { basic: "slash", skill1: "dashSlash", skill2: "blink", ult: "n_ult" };

/* 一局两人：BOT 是待测人机，FOE 只是个站在远/近处的靶子（不跑 AI，不会动） */
function scene(opt) {
  opt = opt || {};
  const me = B.mkHero(0, { x: 0, y: 0, look: LD.Profile.look(), loadout: BASE, name: "BOT" });
  me.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  me.team = 0;
  AI.mkBot(me, "normal");
  const foe = B.mkHero(1, { x: 0, y: 0, look: LD.Profile.look(), loadout: BASE, name: "FOE" });
  foe.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  foe.team = 1;

  B.setup({ mode: "duel", rule: opt.rule || "brawl", fighters: [me, foe], isHost: true, mySide: 0, matchT: 180,
    mapCfg: LD.mapCfg({ preset: "arena", seed: 7, ground: "stone" }) });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0; B.roundT = 0;
  me.invuln = 0; foe.invuln = 0;

  const w = B.world.w, top = B.world.pt || 0, cy = top + (B.world.h - top) / 2;
  me.x = w / 2 - 200; me.y = cy;
  foe.x = opt.foeNear ? me.x + 200 : w - 200;
  foe.y = cy;
  foe.hp = foe.maxHp = 9999;          // 靶子别被顺手打死，否则「附近有人」的前提就没了

  /* 有敌人时箱子挪到人机背后：还摆在两人中间的话，随手一击就能把它打碎，
   * 「不开箱」这条就测不出真假了（箱子是被打碎的，不是被搜开的）。 */
  const bx = opt.foeNear ? me.x : w / 2;
  const by = opt.foeNear ? cy - 160 : cy;
  const box = {
    uid: 88001, kind: "supply", mat: "crate_supply", shape: "square",
    x: bx, y: by, w: 40, h: 40, ox: bx, oy: by, elev: 26, mass: 1.2,
    hp: 20, maxHp: 20, dead: false, flash: 0, vx: 0, vy: 0, free: false, glow: "#7dd3fc",
    boomR: 0, boomDmg: 0, variant: 3, soft: false, blockMove: true, blockProj: true, side: -1
  };
  B.terrain.props.push(box);

  /* 数一数到底掉没掉东西：掉落可能当场被踩掉，只看 pickups 会漏 */
  let drops = 0;
  const orig = B.dropPickup;
  B.dropPickup = function () { drops++; return orig.apply(this, arguments); };

  return {
    me: me, foe: foe, box: box, cy: cy,
    drops: () => drops,
    run(n, each) {
      for (let i = 0; i < n; i++) {
        AI.tickHero(me, 1 / 60);
        B.update(1 / 60);
        if (each) each(i);
      }
    }
  };
}

console.log("\n=== 1. 工具函数 ===");
{
  check("AI.nearestFoeDist 存在", typeof AI.nearestFoeDist === "function");
  const s = scene({ foeNear: false });
  const d = AI.nearestFoeDist(s.me);
  check("量到的是真实距离（600 上下）", d > 550 && d < 650, Math.round(d) + "px");
  s.foe.dead = true;
  check("没有活敌人时返回 Infinity", AI.nearestFoeDist(s.me) === Infinity);
  s.foe.dead = false;
  s.foe.x = s.me.x;
  check("同队不算敌人", (function () {
    s.foe.team = s.me.team;
    const v = AI.nearestFoeDist(s.me) === Infinity;
    s.foe.team = 1;
    return v;
  })());
}

console.log("\n=== 2. 附近没人 → 会走过去开箱 ===");
{
  const s = scene({ foeNear: false });
  let sawChg = false, minGap = Infinity;
  s.run(60 * 8, () => {
    if (s.me.chg && s.me.chg.kind === "supply") {
      sawChg = true;
      minGap = Math.min(minGap, Math.hypot(s.me.x - s.box.x, s.me.y - s.box.y));
    }
  });
  check("人机起了「搜刮补给箱」的蓄力", sawChg);
  check("箱子被搜开", s.box.dead === true);
  check("真的掉了东西", s.drops() >= 1, s.drops() + " 件");
  check("搜刮时就站在箱子边（不是远处隔空开）", minGap < 96, Math.round(minGap) + "px");
}

console.log("\n=== 3. 敌人在旁边 → 不去开箱 ===");
{
  const s = scene({ foeNear: true });
  s.run(60 * 5);
  check("箱子原封不动", s.box.dead === false);
  check("没起过任何开箱蓄力", !s.me.chg);
  check("交互目标里没有补给箱", !s.me.useTarget || s.me.useTarget.type !== "supply",
    s.me.useTarget && s.me.useTarget.type);
}

console.log("\n=== 4. 读条途中有人摸过来 → 放弃并进入冷却 ===");
{
  const s = scene({ foeNear: false });
  let sawChg = false, cancelledAt = -1, cdAtCancel = 0, boxDeadAtCancel = null;
  s.run(60 * 6, i => {
    if (s.me.chg) {
      sawChg = true;
      /* 敌人贴到脸上：此时继续读条＝白白挨打 */
      s.foe.x = s.me.x + 90; s.foe.y = s.me.y;
    } else if (sawChg && cancelledAt < 0) {
      cancelledAt = i / 60;
      /* 冷却要在放弃的那一刻就写上；跑到 6 秒结束时它已经自然走完了 */
      cdAtCancel = s.me.bot.supCd || 0;
      boxDeadAtCancel = s.box.dead;
    }
  });
  check("先起了蓄力", sawChg);
  check("敌人靠近后立刻放弃", cancelledAt > 0, cancelledAt > 0 ? "t=" + cancelledAt.toFixed(2) + "s" : "没放弃");
  check("放弃的那一刻箱子还没被搜开", boxDeadAtCancel === false, String(boxDeadAtCancel));
  check("放弃后进入冷却，不会马上折返", cdAtCancel > 3, cdAtCancel.toFixed(1) + "s");
}

console.log("\n=== 5. 塔防 / 护送 / 渡江：不开箱 ===");
{
  ["tower", "escort", "river"].forEach(rule => {
    const s = scene({ rule: rule, foeNear: false });
    let sawChg = false;
    s.run(60 * 3, () => { if (s.me.chg && s.me.chg.kind === "supply") sawChg = true; });
    check(rule + " 模式里人机不搜箱", !sawChg && s.box.dead === false);
  });
}

console.log("\n=== 6. 源码约定 ===");
{
  const root = path.join(__dirname, "..");
  const ai = fs.readFileSync(path.join(root, "src/js/50_ai.js"), "utf8");
  check("读条中不再重复按交互键（会把读条按没）",
    /if \(f\.useTarget && !f\.chg\)/.test(ai));
  check("补给箱有单独的停步距离", /tp\.kind === "supply" \? 54/.test(ai));
  check("「附近没人」按全场最近的敌人算", /AI\.nearestFoeDist = function/.test(ai));
  check("放弃时静默取消（不往 AI 头上刷字）", /cancelCharge\(f, null\)/.test(ai));
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
