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

  /* ---- 巨龙（人机 boss） ---- */
  dragon: {
    hp: 320,
    speed: 92,
    basic:  { cd: 1.65, dmg: 13, speed: 400, r: 15, windup: 0.45, burst: [1, 1, 2] },
    //        cd 冷却 | dmg 伤害 | speed 弹速 | r 弹体半径 | windup 蓄力前摇 | burst 狂暴阶段的连发数
    skill1: { cd: 4.20, dmg: 20, windup: 0.55, dashT: 0.22, dash: 620, r: 62 },
    //        突刺爪击：windup 红圈预警时长 | dash 冲刺距离 | dashT 冲刺耗时
    ult:    { cd: 15.0, dmg: 26, windup: 1.15, pillars: 7, pillarR: 62, gap: 0.13, dur: 0.85 }
    //        爆裂火焰：pillars 火柱数量 | pillarR 火柱半径 | gap 火柱间隔
  },

  /* ---- 技能表（只列常用项；想调其他项照同样格式加进去即可） ---- */
  skills: {
    slash:      { cd: 1.6, dmg: 14 },                                          // 斩击（近战普攻）
    parry:      { cd: 0.4, dmg: 8 },                                           // 格挡（v2.0 起属于普攻，装在 J 槽）
    fireball:   { cd: 2.10, dmg: 12, proj: { speed: 640, r: 9, life: 2.4 } },  // 远程普攻
    pistol:     { cd: 5.0, dmg: 13, proj: { speed: 820, r: 7, life: 1.6 } },   // 手枪（远程直线普攻）
    rock:       { cd: 4.0, dmg: 8, stun: 0.4, proj: { speed: 640, r: 12, life: 2.2 } },  // 石头（命中眩晕 0.4s）
    mace:       { cd: 5.0, dmg: 18, reach: 76, half: 1.15, windup: 0.3 },      // 狼牙棒（近战蓄力普攻）
    dashSlash:  { cd: 3.2, dmg: 18, dash: 175, invuln: 0.26 },                 // 位移斩
    laserWave:  { cd: 8, dmg: 32, charge: 1.1, range: 540, width: 128 },       // 激光波（蓄力中双击方向键可取消）
    windBlade:  { cd: 5.5, dmg: 16, root: 2.0, proj: { speed: 560, r: 34 } },  // 风刃
    meditate:   { cd: 4.5, heal: 11 },                                         // 冥思
    rockShield: { cd: 8.0, dmg: 16, shield: 36, dur: 3.0 },                    // 岩土盾（被打爆自眩晕 0.6s 在战斗逻辑里）
    dragonPalm: { cd: 8.0, dmg: 24, absorb: 20, proj: { speed: 300, r: 92 } }, // 神龙掌（吸弹上限 20，超出掌印被破）
    meatRush:   { cd: 8.0, dmg: 20, dur: 3.0, mul: 1.9, stun: 0 },            // 肉弹冲击（v2.0 起不再眩晕）
    flyingRaijin:{ cd: 6.0, dmg: 26, boomR: 78, proj: { speed: 420, r: 10, life: 1.4 } },  // 飞雷神（二段瞬移 + 爆炸）
    dung:       { cd: 7.0, dmg: 20, blind: 3.0, proj: { speed: 420, r: 26, life: 2.6 } },  // 粪击（致盲 3s，不锁操作）
    blink:      { cd: 7.5, dmg: 16, charge: 0.85 },                            // 瞬身
    substitute: { cd: 5.0, dmg: 24, back: 155, fuse: 1.0, bombR: 118, stun: 0.6 },  // 替身（爆炸范围加大 + 眩晕 0.6s）
    bloodSlash: { cd: 8.0, dmg: 26, selfCost: 12, heal: 18 },                  // 嗜血斩
    voidSlash:  { cd: 1.0, dmg: 11, charge: 0.5,                               // 虚空爆裂斩（大招）
                  proj: { speed: 400, r: 124, life: 3.0 } },
    bloodRage:  { dur: 6.0, lifesteal: 0.5 },                                  // 血怒（大招）
    thousandSwords: { cd: 1.0, dmg: 9, dur: 4.0, interval: 0.28,               // 千剑杀（大招）
                      proj: { speed: 840, r: 12, life: 1.6 } }
  }
};
