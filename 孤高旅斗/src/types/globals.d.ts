/* 孤高旅斗 · 核心结构类型提示
 *
 * 只为 IDE 补全与跳转服务，**不参与构建**（build.py 只拼接 src/js/*.js，
 * .d.ts 不会被内联进 dist）。checkJs 关闭，所以这里写错也不会报错，
 * 但能让改代码时少踩空——上一轮就出现过 HUD 里误用 `me` 变量、
 * 无头测试没抓到、实机才报错的情况。
 *
 * 只覆盖高频结构；每个接口都带字符串索引签名，未声明的字段一律按 any 处理。
 */

/** 战斗单位：英雄 / BOSS / 小兵 / 僵尸共用一套字段，按需取用 */
interface Fighter {
  x: number; y: number; r: number;
  hp: number; maxHp: number;
  vx: number; vy: number;
  name: string;
  kind: string;                 /* hero / boss / minion / zombie / laneMinion */
  team: number;                 /* 同队互不伤害；烫手山芋全员 -1 */
  side: number;
  dead: boolean; bench: boolean;
  isBot: boolean; bot?: any;
  stun: number; root?: number;
  slot: Record<string, { on?: boolean; t?: number }>;
  cd: Record<string, number>;
  cdM: number;
  respawnT?: number;
  rideCar?: any; hideProp?: any; chg?: any;
  pushBox?: any;                /* 护送：正在推的情报箱 */
  hotMul?: number;              /* 烫手山芋：减速 0.5 / 提速 1.2 */
  lastHurtAt?: number;
  /* 其余字段（技能状态、增益、AI 记忆等）一律按 any */
  [k: string]: any;
}

/** 地形与场景物件 */
interface Prop {
  x: number; y: number; w?: number; h?: number;
  kind: string; hp?: number; maxHp?: number;
  alive?: boolean;
  [k: string]: any;
}

/** 飞行物 / 弹道 */
interface Proj {
  x: number; y: number; vx: number; vy: number;
  type: string; dmg?: number; owner?: Fighter;
  [k: string]: any;
}

/** 战斗主控（全局单例 B，等价于 LD.Battle） */
interface Battle {
  rule: string;                 /* brawl / team / tower / hotpotato ... */
  t: number; dt: number;
  world: { w: number; h: number; pt?: number };
  cam: { x: number; y: number };
  fighters: Fighter[];
  terrain: { props: Prop[]; [k: string]: any };
  pickups: any[];
  stations: any[];              /* 夜战充电站（跨模式残留过 BUG，只在 blackout 使用） */
  crown: any | null;            /* 霸主皇冠（只在 overlord 使用） */
  potato?: any | null;          /* 烫手山芋状态机 */

  setup(o?: any): void;
  update(dt: number): void;
  damage(src: any, tgt: any, o?: any): number;
  kill(src: any, tgt: any, o?: any): void;
  trySlot(f: Fighter, slot: string): void;
  resetRound(): void;
  updateRespawn(dt: number): void;
  packAllowed(): boolean;
  randomRespawnSpot(): { x: number; y: number };
  [k: string]: any;
}

/** 全局数据命名空间 */
interface LD_NS {
  VERSION: string; AUTHOR: string;
  CONF: Record<string, any>;
  WORLD: Record<string, any>;
  RULES: Record<string, any>;
  ESCORT: Record<string, any>;
  CAPTURE: Record<string, any>;
  HOTPOTATO: Record<string, any>;
  TOWER: Record<string, any>;
  AI: Record<string, any>;
  INTERACT: Record<string, any>;
  CHARGE: Record<string, any>;
  Battle: Battle;
  UI: Record<string, any>;
  Profile: Record<string, any>;
  Terrain: Record<string, any>;
  View: Record<string, any>;
  Net: Record<string, any>;
  BGM: Record<string, any>;
  Audio: Record<string, any>;
  FX: Record<string, any>;
  Cine: Record<string, any>;
  part(id: string): any;
  hero(side: number): Fighter | null;
  [k: string]: any;
}

declare const LD: LD_NS;
declare const B: Battle;
declare const UI: Record<string, any>;
declare const P: Record<string, any>;
declare const FX: Record<string, any>;
declare const T: Record<string, any>;     /* Terrain */
declare const V: Record<string, any>;     /* View */
declare const AI: Record<string, any>;
