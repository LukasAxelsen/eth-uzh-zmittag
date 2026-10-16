**Zmittag 独立营养计算核心（2026-10-16）**

可直接在浏览器或 Node.js 中运行的 ES module，零运行时依赖、零网络请求。交付范围是计算、共用数据对象和公式规范；没有接入网站界面、偏好存储或部署。

- [完整公式规范（中文）](./FORMULAS.zh-CN.md)：每个体系的输入、八项营养指标、午晚餐算法、适用边界与出处。
- [类型定义](./core.d.mts)：共用 `UserProfile`、请求与结果对象、Hall 动态模型接口。
- [计算代码](./core.mjs)、[原始系数与参考表](./reference-data.mjs)、[Hall 模型](./hall.mjs)。
- [44 项来源索引](./SOURCES.md)、[验证记录](./VALIDATION.md)。
- [可运行示例](./example.mjs)、[测试](./test/)、[性能检查](./benchmark.mjs)。

在本目录运行（Node.js ≥18，无须 `npm install`）：

```sh
npm test
npm run example
npm run bench
```

`npm test` 使用 Node 内置测试模块，共 22 项。TypeScript 消费者检查样例为 `test/typecheck.mts`；可选的真实浏览器检查为 `test/browser-smoke.py`（仅这个验证脚本需要 Python Playwright／Chromium，计算核心不需要）。

浏览器可以直接 `import { calculateTargets } from './core.mjs'`。模块没有读取 DOM、保存个人资料或发起请求的行为。

```js
import { calculateTargets } from './core.mjs';

const profile = {
  ageYears: 30,
  sex: 'male',             // 原方程使用的生理类别
  heightCm: 180,
  weightKg: 75,
  activity: { pal: 1.6 }
};

const result = calculateTargets({
  standard: 'us_nasem',
  profile,
  // 这里只是显式选定的演示比例，不是所有标准的官方午晚餐比例。
  allocation: { kind: 'explicit', lunch: 0.4, dinner: 0.3 }
});

console.log(result.daily.kcal.references[0].amount);  // 2871.07 kcal/day
console.log(result.lunch.protein.references);        // RDA、AMDR 分别保留
console.log(result.dinner.fiber.references);
```

已覆盖 13 个有明确名称的体系／指南：EFSA、DGE/ÖGE、瑞士 BLV、中国 DRIs 2023、NASEM、DGA 2025–2030、WHO、DGE 运动、ISSN、AND/DC/ACSM、NICE NG246、德国 S3、中国成人肥胖食养指南。另有 Mifflin、Henry 能量估算和 Hall 2011 动态模型。

后续开发请以 `status`、`references[].kind`、`referenceType` 和 `analyte` 共同决定显示方式。PRI/RDA/AI 不是安全上限；餐次预算不是单餐医学阈值；当前餐点的总糖不能直接比较添加糖／游离糖。标准本身未给出的数值会明确返回 `not_defined`，不会用其他体系偷偷补齐。
