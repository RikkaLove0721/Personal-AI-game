/* 孤高旅斗 v4.10 护送情报箱测试（推箱制重做）
 * 覆盖：模式注册 / 参数 / 开局（两队归并 + 左右分驻 + 中央大箱子）/
 *       推箱交互（开始 / 松手 / 占用 / 禁碰）/ 推箱减速 / 交付得分 /
 *       先到 3 分结束 / 被击打断（眩晕 + 禁碰）/ 限时按分数判胜 / AI 目标 / 渲染不崩
 */
const SB = require("./_sandbox.js");
const { fs, path, html, code, makeCtx, makeEl, makeSandbox } = SB;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log("  \u2714 " + label + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  \u2718 " + label + (extra ? "  \u2192 " + extra : "")); }
}


const sb = makeSandbox();
const LD = sb.LD, B = LD.Battle;
LD.CONF.critRate = 0;

const BASE = { basic: "slash", skill1: null, skill2: null, ult: null };
function mkHero(side, team) {
  const f = B.mkHero(side, { x: 800, y: 900, look: LD.Profile.look(), loadout: BASE, name: "H" + side });
  f.ctrl = { mx: 0, my: 0, hold: {}, press: {} };
  f.team = team == null ? -1 : team;
  return f;
}
function setupEscort(n, teams) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(mkHero(i, teams ? teams[i] : -1));
  B.setup({ mode: "duel", rule: "escort", fighters: list, isHost: true, mySide: 0, matchT: 120 });
  B.resetRound(false);
  B.state = "fight"; B.countdown = 0;
  return list;
}

console.log("=== 1. 模式与参数 ===");
{
  const ri = LD.ruleInfo("escort");
  check("「护送情报箱」已注册", ri.id === "escort" && ri.name === "护送情报箱", ri.icon + " " + ri.name);
  const E = LD.ESCORT;
  check("先到 3 分获胜", E.need === 3);
  check("地图长度 2080（1.3 倍）", E.world.w === 2080 && E.world.h === 1600, E.world.w + "×" + E.world.h);
  check("箱子 2x2（80px）", E.boxW === 80, E.boxW);
  check("推箱移速 20%", Math.abs(E.pushSpeed - 0.20) < 1e-6, E.pushSpeed);
  check("打断眩晕 1s / 禁碰 3s", E.stun === 1.0 && E.noTouch === 3.0, E.stun + " / " + E.noTouch);
  check("交付点半径 110 / 推箱距离 96", E.goalR === 110 && E.pushRange === 96);
}

console.log("\n=== 2. 开局布置 ===");
{
  const hs = setupEscort(2);
  const st = B.escort;
  check("比分 0:0", st.score[0] === 0 && st.score[1] === 0, st.score.join(":"));
  check("箱子在地图正中且是活的", Math.abs(st.box.x - B.world.w / 2) < 1 && st.box.alive === true,
    st.box.x + "," + st.box.y);
  const g0 = B.escortGoalOf(0), g1 = B.escortGoalOf(1);
  check("红队交付点在左侧", Math.abs(g0.x - LD.ESCORT.goalInset) < 1 && g0.team === 0, g0.x);
  check("蓝队交付点在右侧", Math.abs(g1.x - (B.world.w - LD.ESCORT.goalInset)) < 1 && g1.team === 1, g1.x);
  check("没分队时按座位奇偶补齐（0→红 / 1→蓝）", hs[0].team === 0 && hs[1].team === 1,
    hs[0].team + "/" + hs[1].team);
  check("红队分驻左端 / 蓝队分驻右端",
    hs[0].x < B.world.w * 0.3 && hs[1].x > B.world.w * 0.7,
    Math.round(hs[0].x) + " / " + Math.round(hs[1].x));
  check("开局没人推箱", !hs[0].pushBox && !hs[1].pushBox);
}

console.log("\n=== 3. 推箱交互 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], foe = hs[1], st = B.escort;
  /* 离得远没有目标 */
  me.x = st.box.x + 400; me.y = st.box.y;
  const far = B.interactTarget(me);
  check("离得远没有推箱目标", !far || far.type !== "escortPush");
  /* 走近出现「推箱」目标，按 P 开推 */
  me.x = st.box.x + 60; me.y = st.box.y;
  const tgt = B.interactTarget(me);
  check("靠近出现「推箱」目标", tgt && tgt.type === "escortPush" && tgt.label === "推箱", tgt && tgt.label);
  B.doInteract(me);
  check("按 P 进入推箱状态", me.pushBox === st.box && st.box.pusher === me);
  /* 已有人在推 → 别人按 P 提示占用 */
  foe.x = st.box.x - 60; foe.y = st.box.y;
  const tgt2 = B.interactTarget(foe);
  check("别人靠近显示「占用」", tgt2 && tgt2.type === "escortPush" && tgt2.occupied === true, tgt2 && tgt2.label);
  B.doInteract(foe);
  check("占用时按 P 不会抢走箱子", st.box.pusher === me && !foe.pushBox);
  /* 再按一次 P = 松手（清掉上一次按键的交互 CD） */
  me.interactCd = 0;
  B.doInteract(me);
  check("再按一次 P 主动松手", !me.pushBox && st.box.pusher === null);
}

console.log("\n=== 4. 推箱减速 ===");
{
  const hs = setupEscort(1);
  const me = hs[0];
  me.x = 800; me.y = 1200; me.ctrl.mx = 1; me.ctrl.my = 0;
  const x0 = me.x;
  for (let i = 0; i < 30; i++) B.update(1 / 60);
  const dxNormal = me.x - x0;
  /* 开推后再走同样的帧数 */
  const hs2 = setupEscort(1);
  const me2 = hs2[0];
  B.escortStartPush(me2, B.escort.box);
  me2.x = 800; me2.y = 1200; me2.ctrl.mx = 1; me2.ctrl.my = 0;
  const x1 = me2.x;
  for (let i = 0; i < 30; i++) B.update(1 / 60);
  const dxPush = me2.x - x1;
  check("推箱移动比空手慢（约 20%）", dxPush > 0 && dxPush < dxNormal * 0.4,
    "空手 " + dxNormal.toFixed(1) + " / 推箱 " + dxPush.toFixed(1));
}

console.log("\n=== 5. 推箱位移与交付得分 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], st = B.escort;
  B.escortStartPush(me, st.box);
  /* 朝右推：推手挪到箱子正后方，箱子应被推到面前（往右挪） */
  me.facing = { x: 1, y: 0 };
  me.x = st.box.x; me.y = st.box.y;
  const bx0 = st.box.x;
  B.updateEscort(1 / 60);
  check("箱子跟随推箱者移动", st.box.x > bx0, bx0 + " → " + Math.round(st.box.x));
  /* 推进蓝队交付点 → 红队 +1 */
  const goal = B.escortGoalOf(1);
  me.x = goal.x - me.r - 40; me.y = goal.y;      // 箱子中心会被推到圈里
  me.facing = { x: 1, y: 0 };
  B.updateEscort(1 / 60);
  check("红队把箱子推进蓝队交付点得 1 分", st.score[0] === 1 && st.score[1] === 0, st.score.join(":"));
  check("交付后箱子进入重生倒计时", st.box.alive === false && st.respawnT > 0);
  check("交付后推箱状态解除", !me.pushBox && st.box.pusher === null);

  /* 重生回中央 */
  for (let i = 0; i < 160; i++) B.updateEscort(1 / 60);
  check("箱子 2.2 秒后在中央重新投放", st.box.alive && Math.abs(st.box.x - B.world.w / 2) < 1,
    st.box.x + "," + st.box.y);

  /* 推进自己圈里不算 */
  const hs2 = setupEscort(2);
  const me2 = hs2[0];
  B.escortStartPush(me2, B.escort.box);
  const own = B.escortGoalOf(0);
  me2.x = own.x - me2.r - 40; me2.y = own.y; me2.facing = { x: 1, y: 0 };
  B.updateEscort(1 / 60);
  check("推进自己的交付点不得分", B.escort.score[0] === 0, B.escort.score.join(":"));
}

console.log("\n=== 6. 先到 3 分结束 ===");
{
  const hs = setupEscort(2);
  const st = B.escort;
  st.score[0] = 2;
  const me = hs[0];
  B.escortStartPush(me, st.box);
  const goal = B.escortGoalOf(1);
  me.x = goal.x - me.r - 40; me.y = goal.y; me.facing = { x: 1, y: 0 };
  B.updateEscort(1 / 60);
  check("第 3 分达成后结束对局", B.state === "over", B.state);
  check("比分 3:0 / 标记 done", st.score[0] === 3 && st.done === true, st.score.join(":"));
  check("matchWinner 指向红队座位", B.matchWinner === 0, B.matchWinner);
}

console.log("\n=== 7. 被击打断：眩晕 + 禁碰 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], foe = hs[1], st = B.escort;
  B.escortStartPush(me, st.box);
  B.damage(foe, me, 10, {});
  check("推箱时挨打 → 打断推箱", !me.pushBox && st.box.pusher === null);
  check("被打断后眩晕 1 秒", Math.abs(me.stun - 1.0) < 0.05, me.stun);
  check("被打断后 3 秒禁碰箱子", Math.abs(me.noBoxT - 3.0) < 0.05, me.noBoxT);
  me.x = st.box.x + 60; me.y = st.box.y;
  me.stun = 0;
  const tgt = B.interactTarget(me);
  check("禁碰期间箱子不是交互目标", !tgt || tgt.type !== "escortPush");
  B.doInteract(me);
  check("禁碰期间按 P 也开不了推", !me.pushBox);
  /* 禁碰结束后可以再推 */
  for (let i = 0; i < 200; i++) B.updateEscort(1 / 60);
  me.x = st.box.x + 60; me.y = st.box.y;
  me.interactCd = 0;
  B.doInteract(me);
  check("禁碰结束后可以重新推箱", me.pushBox === st.box);
}

console.log("\n=== 8. 推箱者阵亡 → 箱子留在原地 ===");
{
  const hs = setupEscort(2);
  const me = hs[0], st = B.escort;
  B.escortStartPush(me, st.box);
  const bx = st.box.x, by = st.box.y;
  me.x = 900; me.y = 1000; me.facing = { x: 1, y: 0 };
  B.updateEscort(1 / 60);              // 箱子跟到推手面前
  const bx2 = st.box.x, by2 = st.box.y;
  me.dead = true;
  B.updateEscort(1 / 60);
  check("推箱者阵亡后箱子留在原地", st.box.alive && Math.abs(st.box.x - bx2) < 1 && Math.abs(st.box.y - by2) < 1,
    Math.round(st.box.x) + "," + Math.round(st.box.y));
  check("阵亡者的推箱状态被清掉", !me.pushBox && st.box.pusher === null);
}

console.log("\n=== 9. 限时结算 ===");
{
  const hs = setupEscort(2);
  B.escort.score[0] = 1; B.escort.score[1] = 0;
  B.roundT = -0.01;
  B.updateEscort(1 / 60);
  check("时间到比分高者获胜", B.state === "over" && B.matchWinner === 0, "winner=" + B.matchWinner);

  const hs2 = setupEscort(2);
  hs2[0].hp = 40; hs2[1].hp = 180;
  B.escort.score[0] = 1; B.escort.score[1] = 1;
  B.roundT = -0.01;
  B.updateEscort(1 / 60);
  check("同分比剩余总血量（蓝队血多则蓝胜）", B.state === "over" && B.matchWinner === 1, "winner=" + B.matchWinner);
}

console.log("\n=== 10. AI 目标 ===");
{
  /* 空手：朝箱子走，到箱边按 P */
  const hs = setupEscort(2);
  const ai = hs[0], foe = hs[1];
  ai.x = 400; ai.y = 400;
  foe.x = 1200; foe.y = 1200;
  LD.AI.mkBot(ai, "normal"); ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  const toBox = Math.hypot(B.escort.box.x - ai.x, B.escort.box.y - ai.y);
  const dot = ai.ctrl.mx * (B.escort.box.x - ai.x) / toBox + ai.ctrl.my * (B.escort.box.y - ai.y) / toBox;
  check("空手 AI 朝情报箱移动", dot > 0.6, "朝向点积 " + dot.toFixed(2));

  /* 到箱边会按交互键开推 */
  ai.x = B.escort.box.x + 50; ai.y = B.escort.box.y;
  ai.bot.think = 0;
  LD.AI.tickHero(ai, 1 / 60);
  check("AI 到箱边会按交互键开推", ai.ctrl.press.interact === true);

  /* 推箱：朝敌方交付点走 */
  const hs2 = setupEscort(2);
  const ai2 = hs2[0];
  B.escortStartPush(ai2, B.escort.box);
  ai2.x = 800; ai2.y = 800;
  hs2[1].x = 300; hs2[1].y = 300;
  LD.AI.mkBot(ai2, "normal"); ai2.bot.think = 0;
  LD.AI.tickHero(ai2, 1 / 60);
  const goal = B.escortGoalOf(1);
  const d2 = Math.hypot(goal.x - ai2.x, goal.y - ai2.y);
  const dot2 = ai2.ctrl.mx * (goal.x - ai2.x) / d2 + ai2.ctrl.my * (goal.y - ai2.y) / d2;
  check("推箱 AI 朝敌方交付点移动", dot2 > 0.6, "朝向点积 " + dot2.toFixed(2));
}

console.log("\n=== 11. 渲染层不崩 ===");
{
  const hs = setupEscort(2);
  B.escortStartPush(hs[0], B.escort.box);
  const ctx = makeCtx();
  let err = null;
  try { B.draw(ctx); } catch (e) { err = e; }
  check("护送模式的交付点 / 大箱子 / 引导线可以正常绘制", !err, err ? err.message : "ok");
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
