/* ============================================================
 *  balance.js — 孤高旅斗 平衡配置文件
 * ============================================================
 *  用法：改完这份文件，刷新游戏（或重启 exe）即可生效，不需要重新构建。
 *  - 数值会覆盖游戏内置默认值，未写到的项保持默认
 *  - 嵌套对象（如 proj）里的项可以只写想改的那几个
 *  - dist/ 或 exe 旁边的 balance.js 优先于内置默认
 * ============================================================ */
window.LD_BALANCE = {

  /* ---- 勇者基础 ---- */
  hero: {
    hp: 200,          // 血量
    speed: 195        // 移动速度（像素/秒）
  },

  /* ---- 能量（大招需求） ---- */
  energy: {
    max: 150,         // 大招需要的能量
    onHit: 12,        // 命中敌人回能
    onHurt: 10,       // 被击中回能
    regen: 2.2        // 每秒自然回能
  },

  /* ---- 暴击 ---- */
  crit: {
    rate: 0.10,       // 暴击概率（0~1）
    mul: 2            // 暴击伤害倍率
  },

  /* ---- 双击方向键闪避 ---- */
  dodge: {
    cd: 2.5,          // 冷却（秒）
    dist: 96          // 位移距离（像素）
  },

  /* ---- 格挡反制冷却 ---- */
  parry: {
    cdBasic: 2,       // 空放或挡下普攻后的冷却（秒）
    cdSkill: 8        // 挡下技能或大招后的冷却（秒）
  },

  /* ---- 难度（v2.5：困难 = 血量 2 倍 + 出手频率更高） ---- */
  diff: {
    normal: { hpM: 1.00, dmgM: 1.00, rateM: 1.00 },
    hard:   { hpM: 2.00, dmgM: 1.40, rateM: 1.60 }
  },

  /* ---- 巨龙（人机 boss，v2.3 全面削弱） ---- */
  dragon: {
    hp: 100,
    speed: 92,
    basic:  { cd: 2.60, dmg: 10, speed: 400, r: 15, windup: 0.60, burst: [1, 1, 2] },
    //        cd 冷却 | dmg 伤害 | speed 弹速 | r 弹体半径 | windup 蓄力前摇 | burst 狂暴阶段的连发数
    skill1: { cd: 6.00, dmg: 14, windup: 0.70, dashT: 0.22, dash: 620, r: 62 },
    //        突刺爪击：windup 红圈预警时长 | dash 冲刺距离 | dashT 冲刺耗时
    ult:    { cd: 42.0, dmg: 12, ultFirst: 14, windup: 1.60, pillars: 6, pillarR: 62, gap: 0.16, dur: 0.85, warn: 0.9 }
    //        爆裂火焰：warn 火柱落地前预警时长（加长让人能躲）
  },

  /* ---- 神秘黑侠客（第 2 关，v2.5 新增） ---- */
  BOSS: {
    ninja: {
      hp: 150, speedMul: 1.08,
      basic:  { cd: 1.30, dmg: 9, speed: 700, r: 9, life: 2.2 },              // 飞镖（远程普攻）
      skill1: { cd: 10.0, dur: 6.0 },                                         // 暗影分身：同血量同外形，6s 后消失
      skill2: { cd: 7.0, dmg: 12, windup: 0.4, hits: 3, gap: 0.17, reach: 96 },  // 突袭：闪现 + 0.4s 蓄力 + 三连斩
      ult:    { cd: 20.0, ultFirst: 10, dmg: 12, tick: 0.35,                  // 螺旋手里剑：中速巨大蓝球
                speed: 250, r: 54, life: 4.5, pull: 130, pullR: 175 }         //   中度吸引 + 每段 12 伤
    },
    gun: {
      hp: 190, speedMul: 1.05,
      basic:  { cd: 1.00, dmg: 8, speed: 860, r: 7, life: 1.5 },              // 快枪：全程 1s 一枪
      skill1: { cd: 6.00, dmg: 22, fuse: 1.05, boomR: 112 },                  // 炸弹投掷（朝玩家位置）
      skill2: { cd: 8.00, dmg: 7, n: 10, gap: 0.07, spread: 0.15, speed: 900, r: 6, life: 1.3 },  // 连环十响
      ult:    { cd: 26.0, ultFirst: 12, dur: 8.0 }                            // 幻影隐身：8s 隐身且攻击不现形
    }
  },

  /* ---- 天外来物（掉落模式） ---- */
  gifts: {
    skillEvery: 10,    // 每 10s 降落一个技能
    ultEvery: 20,      // 每 20s 降落一个大招
    firstSkill: 3,     // 首个技能掉落延迟
    firstUlt: 8,       // 首个大招掉落延迟
    fallT: 2.0,        // 降落耗时 2 秒
    maxSkill: 3,       // 场上最多 3 个技能掉落物
    maxUlt: 2,         // 场上最多 2 个大招掉落物
    pickR: 30,         // 拾取半径（额外加在人物半径上）
    swapDelay: 0.3     // 置换延迟：先出手，0.3s 后完成置换
  },

  /* ---- 技能表（只列常用项；想调其他项照同样格式加进去即可） ---- */
  skills: {
    slash:      { cd: 1.6, dmg: 14 },                                          // 斩击（近战普攻）
    parry:      { cd: 0.4, dmg: 8 },                                           // 格挡（v2.0 起属于普攻，装在 J 槽）
    fireball:   { cd: 2.10, dmg: 12, proj: { speed: 640, r: 9, life: 2.4 } },  // 远程普攻
    pistol:     { cd: 3.0, dmg: 13, proj: { speed: 820, r: 7, life: 1.6 } },   // 手枪（远程直线普攻）
    rock:       { cd: 4.0, dmg: 8, stun: 0.4, proj: { speed: 640, r: 12, life: 2.2 } },  // 石头（命中眩晕 0.4s）
    mace:       { cd: 5.0, dmg: 24, stun: 0.4, reach: 76, half: 1.15, windup: 0.3 },  // 狼牙棒（命中眩晕 0.4s）
    dashSlash:  { cd: 4.0, dmg: 18, dash: 350, invuln: 0.26 },                 // 位移斩（350 距离 / CD 4s）
    laserWave:  { cd: 8, dmg: 32, charge: 1.1, range: 540, width: 128 },       // 激光波（蓄力中双击方向键可取消）
    windBlade:  { cd: 5.5, dmg: 16, root: 2.0, proj: { speed: 560, r: 34 } },  // 风刃
    meditate:   { cd: 4.5, heal: 11 },                                         // 冥思
    rockShield: { cd: 8.0, dmg: 16, shield: 36, dur: 3.0 },                    // 岩土盾（被打爆自眩晕 0.6s 在战斗逻辑里）
    dragonPalm: { cd: 8.0, dmg: 24, absorb: 20, proj: { speed: 300, r: 92 } }, // 神龙掌（吸弹上限 20，超出掌印被破）
    meatRush:   { cd: 8.0, dmg: 20, dur: 3.0, mul: 1.9, stun: 0.4 },           // 肉弹冲击（恢复 0.4s 眩晕）
    flyingRaijin:{ cd: 6.0, dmg: 26, boomR: 78, proj: { speed: 420, r: 10, life: 1.4 } },  // 飞雷神（二段瞬移 + 爆炸）
    dung:       { cd: 7.0, dmg: 20, blind: 3.0, proj: { speed: 420, r: 26, life: 2.6 } },  // 粪击（致盲 3s，不锁操作）
    blink:      { cd: 7.5, dmg: 16, charge: 0.85, shield: 20, shieldT: 2.0 },  // 瞬身（瞬移后 2s 吸 20 盾）
    substitute: { cd: 5.0, dmg: 24, back: 155, fuse: 1.0, bombR: 118, stun: 0.6 },  // 替身（爆炸范围加大 + 眩晕 0.6s）
    bloodSlash: { cd: 8.0, dmg: 26, selfCost: 12, heal: 18 },                  // 嗜血斩
    voidSlash:  { cd: 1.0, dmg: 15, charge: 0.5,                               // 虚空爆裂斩（每段 15）
                  proj: { speed: 400, r: 124, life: 3.0 } },
    bloodRage:  { dur: 6.0, lifesteal: 0.5 },                                  // 血怒（大招）
    thousandSwords: { cd: 1.0, dmg: 10, dur: 4.0, interval: 0.28,              // 千剑杀（每把 10）
                      proj: { speed: 840, r: 12, life: 1.6 } },
    he:         { cd: 8.0, dmg: 20, kbDist: 400 },                             // 赫（击飞 400，无撞墙惩罚）
    fireAura:   { cd: 7.0, dur: 4.0, tick: 0.3, tickDmg: 6, auraR: 110, moveMul: 0.85 },  // 火男（0.3s -6，开启期间自身移速 ×0.85）
    stealth:    { cd: 8.0, dur: 4.0, flashAt: 2.0, flashDur: 0.4, shield: 14, shieldT: 2.0 },  // 隐匿（结束后 2s 吸 14 盾）
    hbomb:      { cd: 8.0, dmg: 34, selfDmg: 20, fuse: 4.0, boomR: 150,        // 高压炸弹（34 伤，自伤 20）
                  throwSpd: 430, throwDamp: 1.05 },                            //          二段投掷初速与减速系数
    splitArrow: { cd: 7.0, dmg: 15, splitDmg: 6, splitN: 6, splitLife: 500,    // 穿云箭（再按散成 6 箭）
                  proj: { speed: 760, r: 8, life: 1.4 } },
    hook:       { cd: 7.0, dmg: 22, stun: 0.8, pullDist: 400,                  // 钩索（拖回 400 + 眩晕 0.8s）
                  proj: { speed: 620, r: 11, life: 1.25 } },
    prison:     { dur: 4.0, zoneR: 180, formT: 0.8 },                          // 绝望囚牢（范围缩小，0.8s 成形，无吸附）
    eatDust:    { back: 3.0 },                                                 // 败者食尘（大招：回血 + 回到 3s 前的位置）
    waterOrbs:  { dur: 5.0, dmg: 10, tick: 0.45, absorbMax: 12,                // 水之呼吸（每球可吸收 12 伤害，吸满即碎）
                  orbR: 24, orbitR: 78, spd: 2.6, hitPad: 32 },                // 球半径 24、判定再补 32（判定放宽）
    kingDrop:   { dmg: 50, rise: 1.0, boomR: 170, stun: 1.0 },                 // 王从天降（大招：二段落地 50 伤 + 1s 眩晕，飞起期间自身定身）
    shuriken:   { cd: 1.0, dmg: 12, tick: 0.35, speed: 250, r: 54, life: 4.5,  // 螺旋手里剑（勇者大招：中速巨球 + 吸引 + 每段 12 伤）
                  pull: 130, pullR: 175 }
  }
};
