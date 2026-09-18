# 孤高旅斗

原生 JavaScript + Canvas 的 Q 版格斗小游戏: 支持单人闯关(巨龙格斗), 角色卡房间人机对战, 以及局域网 2-4 人自由混战。Windows 下双击 exe 即玩, 也可直接用浏览器打开构建产物体验单人内容。

当前版本: 2.0

## 功能特性

- 单人巨龙格斗: 关卡制 Boss 战, 普通与困难两档难度, 通关获得金币
- 角色卡房间: 第一张卡是自己(可当场换装扮/技能), 人机卡可增删(最多 3 个)、可选难度与配装
- 三种对战模式: 乱斗 / 阵营(红黄蓝绿四队) / 霸主争霸(击败巨龙抢能量石成为霸主), 单人与联机都可选
- 局域网对战: 房主开服, 2-4 人同房间开打; 准备阶段所有人都是角色卡, 房主可编排人机与模式
- 技能系统: 6 普攻 + 12 技能 + 3 大招, 格挡可弹反远程攻击, 新增手枪/石头/狼牙棒/飞雷神/粪击
- 索敌机制: V 键循环锁定对手, 锁定目标头顶有黄色三角, 追踪类技能优先朝它出手
- 通用操作: 双击方向键短距离闪避(冷却 2.5 秒, 无无敌帧, 与普攻共享冷却)
- 成长系统: 金币经济, 三段式皮肤装配(头/上身/下身), 技能商店自由搭配
- 热更新: exe 优先读取同目录的 html, 更新玩法无需重新打包

## 技术栈

| 类别 | 选型 |
|:---:|:---:|
| 前端 | 原生 JavaScript (ES6+) + HTML5 Canvas + WebAudio, 无框架无依赖 |
| 联机 | WebSocket, 服务器为 Python 标准库手写实现(零第三方依赖) |
| 桌面壳 | pywebview (Edge WebView2) |
| 打包 | PyInstaller onefile |
| 测试 | Node.js 内置 vm 模块无头集成测试 |
| 构建 | Python 脚本 scripts/build.py, 将 src/js 模块合并为单文件 html |

## 快速开始

玩家:

1. 进入 dist/ 目录, 双击 孤高旅斗.exe(黑窗口是服务器, 不要关)
2. 联机: 房主创建房间得到 4 位房号, 朋友用浏览器打开房主地址加入(最多 3 位挑战者)
3. 详细玩法见 docs/使用说明.txt

开发者:

```
python scripts/build.py --version 2.0        # 构建产物到 dist/
node tests/test_smoke.js                     # 集成自测 74 项
node tests/test_v20.js                       # v2.0 新特性自测 83 项
node tests/test_net.js                       # 联机自测 35 项(含 4 人混战)
node tests/dodge_check.js                    # 闪避与激光波回归 10 项
node tests/shield_dodge_check.js             # 共享 CD 与岩土盾回归 20 项
python src/server/孤高旅斗.py --server       # 开服务器(开发态自动读取 dist/)
node tests/srv_check.js 8123                 # 服务器自测 26 项(含 4 席位)
```

发布前所有 js 测试全绿再打包, 比较稳。

## 目录结构

```
.
+-- AGENTS.md            Agent 开发协作守则与项目信息
+-- README.md            本文件
+-- .gitignore
+-- docs/                文档(使用说明, 更新日志)
+-- src/                 源码
|   +-- js/              前端模块(数据/战斗/渲染/联机/界面 分层)
|   +-- server/          Python 局域网服务器与桌面壳
|   +-- shell.html       页面骨架(构建模板)
|   +-- VERSION          版本号
+-- scripts/             构建与辅助脚本
+-- tests/               Node.js 无头集成测试
+-- assets/              手工美术资源(预留)
+-- assets-ai/           AI 生成素材(预留)
+-- dist/                构建产物(html 与 exe, 已被 git 忽略)
```

## 平衡调整

- dist/balance.js: 技能伤害/CD/血量/能量/暴击/闪避/格挡/巨龙数值全部集中在这一个文件
- 改完刷新页面(或重启 exe)即生效, 无需重新构建; 想恢复默认删除该文件再构建即可

## 文档

- docs/使用说明.txt: 面向玩家的完整玩法与操作说明
- docs/CHANGELOG.md: 各版本变更记录
- AGENTS.md: 开发协作守则, 技术栈/架构/目录结构等项目信息随状态维护
