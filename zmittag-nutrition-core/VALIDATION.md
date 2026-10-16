# 验证记录

日期：2026-10-16；版本：1.0.0。独立计算目录，不涉及网站源码修改、菜单构建或部署。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 22 项通过，0 失败／跳过 |
| `node --check` | core、Hall、参考数据模块通过 |
| `npm run example` | 完成；含 NASEM、原生中国查表、ISSN 单次剂量、显式减重组合、Hall 正反算 |
| TypeScript 严格消费者检查 | `test/typecheck.mts` 通过，`--strict --noEmit --module nodenext --moduleResolution nodenext --target es2022` |
| Chromium 原生 ESM 加载 | 通过，Chromium 154.0.8037.57；未使用打包器 |
| 浏览器代表数值 | NASEM EER 2871.07 kcal；午餐蛋白质 RDA 24 g；DGA 晚餐添加糖预算 10 g |
| 浏览器请求检查 | 仅本机页面、core.mjs、reference-data.mjs、hall.mjs；无外部请求 |

TypeScript 仅用于交付验证，安装在临时缓存，不是计算核心依赖。浏览器验证的 Python Playwright 同样只是可选测试工具。

测试内容包括原系数与原表代表值、年龄／PAL 边界、区间不被取中点、午晚餐比例与未分配余量、总糖与相关糖的区别、推荐量与限制量的区别、缺数据与无标准值、参考体重、临床替代方案、来源 ID，以及请求不被修改。Hall 检查基线平衡、能量守恒、步长收敛与目标反算；不声称已完成个体临床验证或与当前 NIH 网页逐位校验。

本机性能观测：

| 场景 | 观测值 |
| --- | --- |
| Node v24.19.0，10,000 次完整 NASEM 日＋午晚目标计算 | 1010.85 ms，约 0.101 ms/次 |
| Chromium 154，10,000 次同类计算 | 约 0.134 ms/次 |
| Node，Hall 90 天目标体重反算，默认步长 0.25 日 | 约 56 ms |

这些是当前环境的测量，不是所有设备的性能保证。资料或设置变化时计算一次即可复用全部餐点；Hall 反算建议在接入时放入 Web Worker。没有因计算而必须上传个人资料的技术需求。
