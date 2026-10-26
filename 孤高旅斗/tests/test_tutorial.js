/* 孤高旅斗 v4.21 · 新手教程测试
 *
 * 教程是「一步一关」的状态机，最容易错的地方不是渲染而是**推进条件**：
 * 哪一步该等什么、什么不算数（被闪避的、同队的、没打中的），
 * 以及「没通关时主菜单第一行是新手教程」这条入口规则。
 *
 * 这里不模拟真实按键，而是直接调事件钩子（tutOnHit / tutOnCast / updateTutorial），
 * 因为钩子就是战斗层唯一会调过来的入口 —— 只要它们对，玩家怎么按都能推进。
 */
const SB = require("./_sandbox.js");
const { makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}

const html = SB.html;
const sb = makeSandbox("tutorial");
const LD = sb.LD, B = LD.Battle, UI = LD.UI, P = LD.Profile, TUT = LD.TUT;

console.log("=== 1. 配置与素材 ===");
{
  check("有教程配置 LD.TUT", !!TUT && Array.isArray(TUT.steps), TUT ? TUT.steps.length + " 步" : "缺失");
  check("九步齐全", TUT.steps.length === 9, TUT.steps.map(s => s.id).join(","));
  check("步骤顺序：移动/普攻/技能/索敌/闪避/交互/开车/道具箱/大招",
    TUT.steps.map(s => s.id).join(",") === "move,attack,skill,lock,dodge,mud,car,box,ult",
    TUT.steps.map(s => s.id).join(","));
  check("闪避步插在索敌后面",
    TUT.steps.findIndex(s => s.id === "dodge") === TUT.steps.findIndex(s => s.id === "lock") + 1);
  check("闪避步的文案讲清了双击 / 手机键 / 穿墙 / 共用 CD", (() => {
    const d = TUT.steps.find(s => s.id === "dodge");
    const t = (d.tip || "") + (d.sub || "");
    return /双击/.test(t) && /闪/.test(t) && /穿墙/.test(t) && /共用/.test(t);
  })(), (() => {
    const d = TUT.steps.find(s => s.id === "dodge");
    return d.tip + " / " + d.sub;
  })());
  check("索敌插在技能后面", TUT.steps.findIndex(s => s.id === "lock") === TUT.steps.findIndex(s => s.id === "skill") + 1);
  check("每一步都有正上方的提示文案", TUT.steps.every(s => (s.tip || "").length >= 4));
  check("每一步都挂「往右走」方向牌", TUT.dir === "往右走", TUT.dir);
  check("首次 50 金币 / 再次 5 金币", TUT.firstReward === 50 && TUT.againReward === 5,
    TUT.firstReward + "/" + TUT.againReward);
  check("技能与大招用的就是商店里那三个",
    !!LD.skill("laserWave") && !!LD.skill("dragonPalm") && !!LD.skill("voidSlash"),
    [LD.skill("laserWave").name, LD.skill("dragonPalm").name, LD.skill("voidSlash").name].join("/"));
  check("教程地图是横向走廊（宽 > 高 2 倍）", TUT.world.w > TUT.world.h * 2,
    TUT.world.w + "x" + TUT.world.h);
  check("只有两根木桩（左边练普攻/技能，右边练索敌）",
    TUT.steps.filter(s => s.dummy != null).length === 2,
    TUT.steps.filter(s => s.dummy != null).map(s => s.dummy).join("/"));
  check("两根木桩依次向右排开",
    TUT.steps.filter(s => s.dummy != null).map(s => s.dummy).every((v, i, a) => i === 0 || v > a[i - 1]),
    TUT.steps.filter(s => s.dummy != null).map(s => s.dummy).join("<"));
  check("技能步沿用左边那根木桩（不另刷）",
    TUT.steps.find(s => s.id === "skill").dummy == null);
  check("大招步不需要靶子", TUT.steps.find(s => s.id === "ult").dummy == null);
  check("交互物之间不超过 320px（走两步就到，不用跑空路）", (() => {
    const xs = TUT.steps.filter(s => s.mud != null || s.car != null || s.box != null)
      .map(s => s.mud != null ? s.mud : (s.car != null ? s.car : s.box));
    const first = TUT.steps.find(s => s.dummy != null && s.id === "lock").dummy;
    const seq = [first].concat(xs);
    return seq.every((v, i) => i === 0 || v - seq[i - 1] <= 320);
  })(), (() => {
    const xs = TUT.steps.filter(s => s.mud != null || s.car != null || s.box != null)
      .map(s => s.mud != null ? s.mud : (s.car != null ? s.car : s.box));
    return [TUT.steps.find(s => s.id === "lock").dummy].concat(xs).join("→");
  })());
  check("放完大招到结算有 5 秒缓冲", TUT.endDelay === 5, TUT.endDelay);
  check("提示条元素在 shell 里",
    /id="tutTip"/.test(html) && /id="tutText"/.test(html) && /id="tutDir"/.test(html));
  check("单人菜单里有新手教程卡片（死战闯关之后）", (() => {
    const a = html.indexOf('id="sGauntlet"'), b = html.indexOf('id="sTut"');
    return a > 0 && b > a;
  })());
}

console.log("=== 2. 开局：只有普攻，没有技能大招 ===");
{
  P.d.tutDone = false;
  P.d.coins = 0;
  UI.startTutorial();
  const h = B.tutHero;
  check("进入教程模式", B.mode === "tutorial" && B.rule === "tutorial", B.mode);
  check("出生在地图左边（不超过 20% 宽）", h && h.x < TUT.world.w * 0.2, h && Math.round(h.x));
  check("身上只有默认近战普攻",
    h.loadout.basic === "slash" && !h.loadout.skill1 && !h.loadout.skill2 && !h.loadout.ult,
    JSON.stringify(h.loadout));
  check("能量是空的", h.energy === 0);
  check("场上只有两根木桩", B.fighters.filter(f => f.tutDummy).length === 2,
    B.fighters.filter(f => f.tutDummy).map(f => Math.round(f.x)).join("/"));
  check("木桩不动手（简单人机 aggr=0）",
    B.fighters.filter(f => f.tutDummy).every(f => f.bot && f.bot.conf.aggr === 0));
  check("木桩不会被一下打死（4000 血）",
    B.fighters.filter(f => f.tutDummy).every(f => f.maxHp >= 3000));
  check("教程不限时（roundT = 0）", B.roundT === 0, B.roundT);
  check("第一步是移动", B.tut.step === 0 && TUT.steps[0].id === "move");
  check("第一步的提示已经显示在正上方", (() => {
    const t = sb.document.getElementById("tutText");
    const tip = sb.document.getElementById("tutTip");
    return t.textContent === TUT.steps[0].tip && !tip.classList.contains("hide");
  })(), sb.document.getElementById("tutText").textContent);
  check("方向牌写着「往右走」",
    /往右走/.test(sb.document.getElementById("tutDir").textContent),
    sb.document.getElementById("tutDir").textContent);
  check("地图上没有随机道具（props 里只有地面/边界，没有补给箱/车/泥土）",
    !B.terrain || !B.terrain.props || B.terrain.props.every(o => ["solid", "fence"].indexOf(o.kind) >= 0),
    B.terrain && B.terrain.props ? B.terrain.props.map(o => o.kind).join(",") || "空" : "无地形");
}

console.log("=== 3. 八步推进 ===");
{
  const h = B.tutHero;
  const step = () => TUT.steps[B.tut.step] ? TUT.steps[B.tut.step].id : "done";
  const tick = () => B.updateTutorial(0.016);
  const dummyOf = () => B.tut.dummy;
  /* 走完全程用的靶子：左（普攻 + 技能）、右（索敌）。
   * 不取 st.dummy —— 那东西只在「这一步配了木桩」时才有值，
   * 以前测试靠它跨步残留拿到靶子，属于巧合。 */
  const dummyA = B.fighters.find(f => f.tutDummy && f.tutForStep === 1);
  const dummyB = B.fighters.find(f => f.tutDummy && f.tutForStep === 3);

  /* ① 移动 */
  h.x += TUT.moveDist - 10;
  tick();
  check("走不够远不推进", step() === "move", step());
  h.x += 40;
  tick();
  check("走到距离后进入第 2 步", step() === "attack", step());
  check("第 2 步对准木桩并给提示",
    !!dummyOf() && sb.document.getElementById("tutText").textContent === TUT.steps[1].tip);

  /* ② 普攻 */
  B.tutOnHit(h, dummyA, 10, { type: "basic" });
  tick();
  check("普攻命中后进入第 3 步", step() === "skill", step());

  /* ③ 技能：现场发 K / L */
  check("第 3 步才发两个技能",
    h.loadout.skill1 === "laserWave" && h.loadout.skill2 === "dragonPalm",
    h.loadout.skill1 + "/" + h.loadout.skill2);
  B.tutOnCast(h, "skill1");
  B.tutOnHit(h, dummyA, 20, { type: "skill" });
  tick();
  check("只打中 K 不推进（要两个都打中）", step() === "skill", step());
  B.tutOnCast(h, "skill2");
  B.tutOnHit(h, dummyA, 20, { type: "skill" });
  tick();
  check("K 和 L 都打中后进入第 4 步（索敌）", step() === "lock", step());

  /* ④ 索敌 */
  const right = B.tut.dummy;
  const left = B.fighters.find(f => f.tutDummy && f !== right);
  check("第 4 步指的是右边那根木桩",
    !!right && right === dummyB && right.x > left.x,
    right && left ? Math.round(left.x) + "<" + Math.round(right.x) : "缺失");
  check("进入这一步时锁定先摆在左边（按一次 V 就切过去）",
    h.lock === left.side, "lock=" + h.lock + " left=" + left.side);
  tick();
  check("不按 V 不推进", step() === "lock", step());
  /* 锁错对象（锁左边）不算通过 */
  h.lock = left.side;
  tick();
  check("锁在左边木桩上不算通过", step() === "lock", step());
  /* 玩家把右边那根木桩打退了一段（技能击退的真实后果）：
   * 旧实现按坐标找木桩，这里会 st.dummy = null 直接死锁。 */
  right.x += 90;
  const got = B.cycleLock(h, 1);
  tick();
  check("木桩被击退位移后依然能判定（旧版在这里死锁）",
    got === right && step() === "dodge",
    "lock=" + h.lock + " -> " + step());

  /* ⑤ 闪避：走真实链路（ctrl.dodge -> B.updateHero），不是直接调钩子 */
  check("第 5 步是闪避", step() === "dodge", step());
  check("闪避步不再要求靶子", B.tut.dummy === null);
  tick();
  check("没闪避不推进", step() === "dodge", step());

  const savedCtrl = h.ctrl;
  h.ctrl = { mx: 0, my: 0, dodge: { x: 1, y: 0 },
             hold: { basic: false, skill1: false, skill2: false, ult: false, interact: false },
             press: { basic: false, skill1: false, skill2: false, ult: false, interact: false } };
  /* 冷却中按键：只弹「闪避冷却中」，不做位移，不该算学会 */
  h.cd.dodge = 2;
  const xBefore = h.x;
  B.updateHero(h, 1 / 60);
  tick();
  check("冷却中按闪避不算（没有真的位移出去）",
    step() === "dodge" && Math.abs(h.x - xBefore) < 0.01, "x差 " + (h.x - xBefore).toFixed(2));
  /* 冷却清掉再按：真的位移 + 推进 */
  h.cd.dodge = 0;
  h.ctrl.dodge = { x: 1, y: 0 };
  B.updateHero(h, 1 / 60);
  tick();
  check("真的闪避出去后进入下一步", step() === "mud", step());
  check("闪避确实位移了一段（不是只打了个标记）", Math.abs(h.x - xBefore) > 20,
    (h.x - xBefore).toFixed(1) + "px");
  check("闪避会锁住普攻（共用冷却）", (h.cd.basic || 0) > 0, "basic cd " + (h.cd.basic || 0).toFixed(1));
  h.ctrl = savedCtrl;

  /* ⑥ 泥块：捡起 + 扔出 */
  check("第 6 步地图上出现泥土", !!(B.tut.mud && B.tut.mud.kind === "mud"));
  h.carryMud = B.tut.mud;
  tick();
  check("只捡起来不推进", step() === "mud", step());
  h.carryMud = null;
  tick();
  check("捡起再扔出后进入第 7 步", step() === "car", step());

  /* ⑦ 开车：上车 + 下车 */
  check("第 7 步地图上出现汽车", !!(B.tut.car && B.tut.car.kind === "car"));
  h.rideCar = B.tut.car;
  tick();
  check("只上车不推进", step() === "car", step());
  h.rideCar = null;
  tick();
  check("上车再下车后进入第 8 步", step() === "box", step());

  /* ⑧ 道具箱 */
  check("第 8 步地图上出现补给箱", !!(B.tut.box && B.tut.box.kind === "supply"));
  check("补给箱不会刷在车上（否则车被 blockMove 卡死）",
    !(B.tut.car && Math.abs(B.tut.box.x - B.tut.car.x) < (B.tut.box.w + B.tut.car.w) / 2 - 2 &&
      Math.abs(B.tut.box.y - B.tut.car.y) < (B.tut.box.h + B.tut.car.h) / 2 - 2),
    B.tut.car ? "车 " + Math.round(B.tut.car.x) + " / 箱 " + Math.round(B.tut.box.x) : "无车");
  B.tut.box.dead = true;
  tick();
  check("打开补给箱后进入第 9 步", step() === "ult", step());

  /* ⑨ 大招 */
  check("第 9 步解锁大招并充满能量",
    h.loadout.ult === "voidSlash" && h.energy >= h.maxEnergy,
    h.loadout.ult + " / " + h.energy);
  const t0 = B.t;
  B.tutOnCast(h, "ult");
  check("放大招后不立刻结算", B.tut.ended !== true && UI.screen !== "ovEnd", UI.screen);
  check("记下 5 秒后的结算时刻", Math.abs((B.tut.endAt - t0) - 5) < 1e-6, B.tut.endAt - t0);
  check("提示条换成「教程完成」",
    sb.document.getElementById("tutNo").textContent === "教程完成",
    sb.document.getElementById("tutNo").textContent);
  B.t += 4.6;
  tick();
  check("4.6 秒时还没结算", B.tut.ended !== true, UI.screen);
  B.t += 0.6;
  tick();
  check("满 5 秒后结算", B.tut.ended === true && B.tut.done === true);
  check("结算面板出现", UI.screen === "ovEnd", UI.screen);
  check("标题是教程完成", sb.document.getElementById("endTitle").textContent === "新手教程完成",
    sb.document.getElementById("endTitle").textContent);
}

console.log("=== 4. 奖励与入口切换 ===");
{
  check("首次通关给 50 金币", P.d.coins === 50, P.d.coins);
  check("存档记下已通关", P.d.tutDone === true);
  check("通关后主菜单第一行变回「单人游戏」", (() => {
    UI.renderMenuEntry();
    return sb.document.getElementById("mSoloLab").textContent === "单人游戏";
  })(), sb.document.getElementById("mSoloLab").textContent);
  check("单人菜单的教程卡片改成「再次通关 5 金币」", (() => {
    UI.renderTutCard();
    const t = sb.document.getElementById("tutDesc").textContent;
    return /5 金币/.test(t) && !/50 金币/.test(t);
  })(), sb.document.getElementById("tutDesc").textContent);

  /* 再打一遍：只给 5（走完九步，含 5 秒缓冲） */
  const before = P.d.coins;
  UI.startTutorial();
  const h2 = B.tutHero;
  const tick = () => B.updateTutorial(0.016);
  const dA = B.fighters.find(f => f.tutDummy && f.tutForStep === 1);
  h2.x += 200; tick();
  B.tutOnHit(h2, dA, 10, { type: "basic" }); tick();
  B.tutOnCast(h2, "skill1"); B.tutOnHit(h2, dA, 10, { type: "skill" });
  B.tutOnCast(h2, "skill2"); B.tutOnHit(h2, dA, 10, { type: "skill" }); tick();
  B.cycleLock(h2, 1); tick();
  B.tutOnDodge(h2); tick();
  h2.carryMud = B.tut.mud; tick(); h2.carryMud = null; tick();
  h2.rideCar = B.tut.car; tick(); h2.rideCar = null; tick();
  B.tut.box.dead = true; tick();
  B.tutOnCast(h2, "ult");
  B.t += 5.1; tick();
  check("再次通关只给 5 金币", P.d.coins === before + 5, "+" + (P.d.coins - before));
  check("通关记录不会翻回去", P.d.tutDone === true);
}

console.log("=== 5. 不该推进的情况 ===");
{
  P.d.tutDone = false;
  UI.startTutorial();
  const h = B.tutHero;
  h.x += 200; B.updateTutorial(0.016);          // 到第 2 步
  const d = B.tut.dummy;
  B.tutOnHit(h, d, 10, { type: "skill" });      // 技能伤害，但这一步等的是普攻
  B.updateTutorial(0.016);
  check("第 2 步只认普攻，技能打中不算", TUT.steps[B.tut.step].id === "attack",
    TUT.steps[B.tut.step].id);

  /* 第 3 步：只算 2 秒内的施法 */
  B.tutOnHit(h, d, 10, { type: "basic" }); B.updateTutorial(0.016);
  B.tutOnCast(h, "skill1");
  B.t += 3.0;                                    // 假装过了 3 秒，技能还没打中
  B.tutOnHit(h, d, 10, { type: "skill" });
  B.updateTutorial(0.016);
  check("施法 2 秒之后才落下的伤害不算这一次技能",
    TUT.steps[B.tut.step].id === "skill" && !B.tut.hit.skill1,
    TUT.steps[B.tut.step].id);

  /* 第 4 步：锁到自己人 / 锁到空地都不算 */
  B.tutOnCast(h, "skill1"); B.tutOnHit(h, d, 10, { type: "skill" });
  B.tutOnCast(h, "skill2"); B.tutOnHit(h, d, 10, { type: "skill" }); B.updateTutorial(0.016);
  check("补齐 K 后走到索敌步", TUT.steps[B.tut.step].id === "lock", TUT.steps[B.tut.step].id);
  const right = B.tut.dummy;
  h.lock = -1;
  B.updateTutorial(0.016);
  check("取消锁定（-1）不算通过", TUT.steps[B.tut.step].id === "lock", "lock=" + h.lock);
  h.lock = right.side + 10;                      // 不存在的座位号
  B.updateTutorial(0.016);
  check("锁到不存在的目标不算通过", TUT.steps[B.tut.step].id === "lock");
}

console.log("=== 6. 车不会被刷出来的箱子卡死 ===");
{
  /* 复现用户报的 bug：把车停到补给箱的落点，然后刷箱子，再试着开走。
   * blockedAt 只看新位置，原来就重叠的话每一帧都被否决 —— 车会永远动不了。 */
  P.d.tutDone = false;
  UI.startTutorial();
  const boxX = TUT.steps.find(s => s.id === "box").box;
  /* 手动把车挪到箱子落点（模拟「玩家把车开到那儿才下车」） */
  const car = LD.Tutorial.addProp("car", "car_red", boxX, B.tutHero.y, 2, 1);
  check("车已停在箱子落点", !!car && Math.abs(car.x - boxX) < 1.5, car && Math.round(car.x));
  const box = LD.Tutorial.addProp("supply", "crate_supply", boxX, B.tutHero.y, 1, 1);
  check("箱子不会叠在车上（自动让位）",
    !!box && Math.abs(box.x - car.x) >= (box.w + car.w) / 2 - 2,
    box && "箱 " + Math.round(box.x) + " 车 " + Math.round(car.x));

  /* 再验一层兜底：万一真的重叠了，车也要能开出来 */
  box.x = car.x; box.y = car.y;
  const T = LD.Terrain;
  check("人为重叠后确实判定为卡住", T.blockedAt(B.terrain, car, car.x, car.y) === true);
  car.driver = B.tutHero;
  car.fuel = car.fuelMax;
  B.tutHero.ctrl = { mx: 1, my: 0 };
  const x0 = car.x;
  for (let i = 0; i < 40; i++) { B.tutHero.ctrl.mx = 1; B.updateVehicles(1 / 30); }
  check("即使重叠也能把车开出去（不再永久卡死）", car.x - x0 > 20, Math.round(car.x - x0) + "px");
  B.tutHero.ctrl.mx = 0;
  car.driver = null;
}

console.log("\n=== 结果 ===");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail ? 1 : 0);
