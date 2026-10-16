# Zmittag 午餐／晚餐营养参考计算规范

版本 1.0.0；资料核查日 2026-10-16。本文与 `core.mjs`、`reference-data.mjs`、`hall.mjs` 一起构成开发依据。这里的“需求”是膳食计划参考量；原标准没有定义的个人精确需要或单餐阈值，不通过软件补造。

## 1. 范围与交付边界

适用于已确认的 18 岁以上、非孕哺期健康成年人，覆盖普通健身和一般体重管理。计算完全在本地进行，无商业 API、无账号、无运行时下载。未实现网站标准切换、表单、餐点比较、进度条、布局或部署。

分别输出全天、午餐和晚餐。由于不记录其他饮食，午晚餐不是“减去今天已经吃过的食物”后的余额，而是全天计划的独立份额。早餐、零食等未分配部分保留，不把午晚餐重新归一化成全天。

八个输出字段与当前网站对应：

| 字段 | 单位 | 比较对象／限制 |
| --- | --- | --- |
| `kcal` | kcal | 能量 |
| `protein` | g | 蛋白质 |
| `fat` | g | 总脂肪，不是烹调油 |
| `saturated` | g | 饱和脂肪 |
| `carbs` | g | 标准中的可利用／供能碳水；供应商定义仍需在接入时保持一致 |
| `sugar` | g | 餐点字段是**总糖**；多数标准规定的是添加糖或游离糖，当前不能直接比较 |
| `salt` | g | 营养标签盐当量，`2.5 × 钠` |
| `fiber` | g | 膳食纤维；食物数据库的测定／定义差异仍存在 |

`weight` 是餐点份重，不是营养目标。每 100 g 数据不能直接与每餐目标比较；需要已有的每份营养数据，或来源已知的份重。未提供的餐点数值不能当作 0。本交付不改餐点数据管线。

不包含儿童、孕哺期、肾脏疾病等需治疗性膳食、进食障碍、竞技减重脱水、术后／衰弱老年人、极端能量限制等处方。高龄健康成人按本标准已公布的年龄行计算，不把衰弱人群的蛋白质范围用于所有老年人。临床指南的算术实现也不意味着软件已完成诊断、适应证判断或个体医疗评估。

## 2. 一份共用个人资料

完整类型见 [core.d.mts](./core.d.mts)。字段统一使用 cm、kg、完整周岁、日。

```ts
interface UserProfile {
  ageYears?: number;                 // 已满周岁，整数
  sex?: 'male' | 'female';           // 原方程采用的类别，不代表性别认同
  weightKg?: number;                // 当前实际体重 W
  heightCm?: number;                // 当前身高 H
  referenceWeightKg?: number;       // 已明确选定的正常参考体重 Wr
  fatMassKg?: number;               // Hall 可选：脂肪量，非体脂百分比
  activity?: {
    pal?: number;                   // PAL = 全天能量消耗 / 基础或静息代谢
    cnClass?: 'light' | 'moderate' | 'heavy';
  };
  training?: {
    weeklyHours?: number;
    carbohydrateLoad?: 'low' | 'moderate' | 'high' | 'very_high';
  };
  pregnant?: boolean;
  lactating?: boolean;
  requiresTherapeuticDiet?: boolean;
}
```

这些字段只存一份。不同标准读同一个年龄、性别、身高、体重，不建立 `euWeight`、`chinaAge` 等重复资料。活动强度的定义因体系而异，因此 `cnClass` 和训练负荷是必要的补充，不是另存一份 PAL。

`cnClass` 会映射到中国相应年龄组原表中的 PAL。若同时提供 PAL，两者必须一致，否则报错。比如中国 18–29 岁轻体力是 1.5，30–64 岁轻体力是 1.4，不能把同一个词直接映射成所有国家通用的系数。

**体重口径：**普通人群的按 kg 参考蛋白质使用 `Wr`；运动建议及 DGA 使用实际 `W`。为避免把超重者实际体重不加说明地当作正常参考体重，核心采用一项明确的保守输入政策：提供 `referenceWeightKg` 时使用它；未提供时，仅在实际 BMI ∈[18.5,25) 时复用实际体重，否则要求补充 `referenceWeightKg`。这个统一输入保护是工程政策，不是宣称所有体系都有相同的 BMI 分类；中国肥胖分支仍使用中国 24／28 的界限。参考体重没有统一科学公式，因此不暗设 BMI=22，也不自动把体重“修正”为某个值。

Hall 将脂肪量、结构性瘦组织、细胞外液和糖原分开。`fatMassKg` 与 `referenceWeightKg` 不能互相代替；体脂百分比需要先显式乘以实际体重再换成脂肪 kg。

`pregnant`、`lactating`、`requiresTherapeuticDiet` 为 true，或年龄 <18 时，结果为 `out_of_scope`。本轮既定前提是健康成年人；缺省这些布尔值不是一项医疗筛查。缺少计算所需数据用 `missingInputs` 返回，不编造默认年龄、性别、体重或活动水平。

### 每个体系实际读取哪些输入

| 体系 ID | 原生能量输入 | 其他营养量输入／选择 |
| --- | --- | --- |
| `efsa` | 年龄、性别、PAL 原表值 | 蛋白质 `Wr` |
| `dge_oege` | ≥19 岁：年龄、性别、实际体重、PAL；18 岁：年龄、性别、原表 PAL | 蛋白质 `Wr`；18 岁还区分性别 |
| `ch_blv` | 年龄、性别；返回群体区间 | 蛋白质 `Wr`；66 岁起其他值改变 |
| `cn_dri_2023` | 年龄、性别、`cnClass` 或原表 PAL | 蛋白质 RNI 按年龄、性别固定查表 |
| `us_nasem` | 年龄、性别、实际体重、身高、PAL | 蛋白质 RDA 用 `Wr`；纤维按年龄、性别 |
| `us_dga_2025` | 自身未提供此处可用的个体能量方程；显式指定方法／能量 | 实际体重；糖是原生每餐值 |
| `who` | 显式指定能量方法／能量 | 游离糖采用常规 <10% 或有条件的 <5% |
| `dge_sport` | 显式指定能量方法／能量 | 实际体重、每周训练小时数 |
| `issn` | 同上 | 实际体重；每餐策略三选一 |
| `acsm` | 同上 | 实际体重、训练碳水负荷 |
| `nice_ng246` | 显式维持能量及个体化缺口 | 未给出完整八项定量处方 |
| `dag_s3_2024` | 显式维持能量；原指南缺口范围或个体缺口 | 游离糖限制、纤维质量；可明确选 DGE 宏量参考策略 |
| `cn_obesity_2024` | W、H 用于确认 BMI≥24；显式选择五种能量路径之一；见第 8 节 | 原指南宏量比例、盐、添加糖；可选原生 3:4:3 分配 |

任何体系都需要年龄以确认成人范围。采用 `energy` 显式覆盖原生方法时，能量输入要求随所选方法变化。核心不会自动因为更换标准而更改或复制个人资料。

## 3. 单位、数值和午晚餐的严格定义

记全天计划能量为 `E` kcal，蛋白质／碳水的供能系数为 4 kcal/g，脂肪／饱和脂肪为 9 kcal/g。它们用于把膳食供能比例换成计划克数，不能反向要求餐点营养标签必然满足 `E=4P+4C+9F`；纤维、有机酸及舍入等会导致差异。

```text
蛋白质 g = E × 蛋白质供能比例 / 4
碳水 g   = E × 碳水供能比例 / 4
总脂肪 g = E × 脂肪供能比例 / 9
饱和脂肪限制 g = E × 饱和脂肪限制比例 / 9
糖限制 g = E × 相关糖限制比例 / 4
盐当量 g = 钠 mg × 2.5 / 1000
1 kcal = 4.184 kJ；1 MJ = 1000 / 4.184 kcal
```

2.5 是网站所用的营养标签盐当量约定，不是纯 NaCl 的精确摩尔质量比约 2.54；不把两种换算混用。[瑞士营养素定义](https://www.naehrwertdaten.ch/de/nahrstoffe/)

### 明确的餐次份额

```js
allocation: { kind: 'explicit', lunch: alphaL, dinner: alphaD }
// 0 <= alphaL,alphaD <= 1；alphaL + alphaD <= 1
```

对任意**全天**定量参考 `Q`：

```text
Q午餐 = alphaL × Q全天
Q晚餐 = alphaD × Q全天
未分配份额 = 1 − alphaL − alphaD
```

上下端点、参考量、范围、最少建议、最大建议分别同比例投影，不改变其原含义。比如全天的钠减量阈值分配后是本餐的计划预算，不是医学研究证明的单餐阈值。所有八项同比例分配是一项显式的**膳食计划假设**，并非各国标准都直接规定了每餐这些比例。

还可明确选择：

- `{kind:'dge_quarters'}`：午、晚各 25%。出处是 DGE Job&Fit 的四分之一膳食规划模型，不是所有健康成人必须这样吃。[原说明](https://www.jobundfit.de/fachinformationen/faq)
- `{kind:'cn_obesity_343'}`：午 40%、晚 30%。中国肥胖指南原生规定的是三餐**能量** 3:4:3；将蛋白质、纤维、盐等也同比例分配是额外的规划假设，输出 provenance 已说明。[原指南 pp.5–7](https://www.cnsoc.org/images/@cmsxh_7108bb5a-13de-4356-a2a9-50d178413c39.pdf)

没有提供 `allocation` 时，不暗设午 35%、晚 30%，也不把全天除以二；相应餐次量返回 `requires_input`。原生每餐规定不受此影响：**DGA 添加糖每餐 ≤10 g，午餐和晚餐各为 10 g；不能乘份额，也不能由此生成“全天 30 g”。**ISSN 的原生每次蛋白质剂量也是例外，见第 7 节。

### 区间不能假装成单点

若 `E∈[EL,EU]`，供能比例 `p∈[pL,pU]`，输出的克数包络为：

```text
[EL × pL / k, EU × pU / k]
```

同时保留 `energyKcal`、`energyFraction`、`uncertainEnergy:true`。这是能量未确定情况下的包络，不代表在任意固定 E 下都允许整个包络。最大限制的 `amount:[EL×p/k,EU×p/k]` 表示“上限本身随 E 变化”，其中 low **不是必须吃到的最低量**。不能取中点后声称已得到个体精确目标。

蛋白质、碳水、脂肪的比例区间也相互关联，最终实际计划的供能比例应协调；不能把每个上端点同时选为推荐菜单。核心分别返回标准的约束，没有自动生成一套宏量组合。

### 参考类型与状态

| 标记 | 开发时的含义 |
| --- | --- |
| PRI／RNI／RDA | 人群膳食计划的推荐参考；不是上限，也不是检验诊断值 |
| AI | 适宜摄入参考；低于 AI 不能直接诊断缺乏；AI 区间的上端不是毒性界线 |
| RI／AMDR | 膳食供能比例范围；不是毒性范围 |
| CDRR | 超过此摄入水平，减少钠预计降低慢性病风险；不是 UL |
| PI | 中国预防非传染性慢性病建议；保持原表方向与术语 |
| `maximum` | 摄入限制／建议预算；是否严格 `<` 由 `upperInclusive:false` 表示 |
| `reference`／`reference_range` | 参考数值／参考区间，不自动解释成最少量或最多量 |

每项 `Metric` 都含 `status`、`references[]`、`missingInputs[]`、`notes[]`：

| status | 含义 |
| --- | --- |
| `ok` | 本项可定义的定量参考已算出；不等于已经有餐点可比较 |
| `partial` | 某些定量参考已算出，其他参考仍缺输入；如中国 RNI 可查但 AMDR 缺能量 |
| `requires_input` | 有计算规则，但缺必要输入 |
| `qualitative` | 有定性建议，没有可诚信输出的克数阈值 |
| `not_defined` | 当前这个体系没有给出此项数值，或该年龄／强度无原表数值 |
| `not_comparable` | 有相关建议，但餐点与标准的分析物不相同；目前主要是糖 |
| `out_of_scope` | 超出本计算范围或该规则适用条件 |

参数若已提供但非法（NaN、负体重、非法 PAL、餐次份额合计 >1 等），抛出 `TypeError`／`RangeError`。缺数据和无标准值不抛成“程序失败”。不作内部舍入；显示舍入留给后续界面。

## 4. 地区原生能量计算

### 4.1 欧盟 EFSA：`efsa_table`

原生路径使用 DRV Finder 公布的年龄 × 性别 × PAL 的 **kcal 原列**，不是任意人的实测需要。不用实际体重按比例放大该群体表，也不把取整 MJ 再换算后覆盖已公布 kcal。

| 完整年龄 | 性别 | PAL 1.4 | 1.6 | 1.8 | 2.0 |
| --- | --- | ---: | ---: | ---: | ---: |
| 18–29 | 男 | 2338 | 2672 | 3006 | 3340 |
| 18–29 | 女 | 1878 | 2147 | 2415 | 2683 |
| 30–39 | 男 | 2264 | 2588 | 2911 | 3235 |
| 30–39 | 女 | 1813 | 2072 | 2331 | 2590 |
| 40–49 | 男 | 2234 | 2553 | 2873 | 3192 |
| 40–49 | 女 | 1798 | 2055 | 2312 | 2569 |
| 50–59 | 男 | 2204 | 2519 | 2834 | 3149 |
| 50–59 | 女 | 1783 | 2037 | 2292 | 2547 |
| 60–69 | 男 | 2017 | 2305 | 2593 | 2882 |
| 60–69 | 女 | 1628 | 1861 | 2093 | 2326 |
| 70–79 | 男 | 1984 | 2267 | 2550 | 2834 |
| 70–79 | 女 | 1614 | 1844 | 2075 | 2305 |

80 岁及以上该表没有数值，返回 `not_defined`；其他 PAL 不插值、不就近取整。需要个体化时显式选 Henry／其他方法，输出保留该独立方法名，不能仍称原生 EFSA 查表。

依据：[EFSA 2013 energy opinion](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2013.3005)、[官方网页数据快照来源](https://multimedia.efsa.europa.eu/drvs/assets/data/languages/en/data.json)。48 行数据已经固化在 `reference-data.mjs`，运行不访问该接口。

### 4.2 德国／奥地利 DGE/ÖGE：`dge_ree`

19 岁起使用 DGE 公开的静息能量估算，A 为完整岁，W 为实际 kg：

```text
女性 REE = (0.047W − 0.01452A + 3.21) × 239 kcal/day
男性 REE = (0.047W − 0.01452A + 3.21 + 1.009) × 239
E = REE × PAL
```

239 保留原文系数，不替换成 1000/4.184 后又称完全同一公式。PAL 已包含全天活动，不能再把训练消耗或 10% 食物热效应重复加一遍。公式是估算而非实测；参考标准原本针对正常体重的健康人，超重个体的能量计划需单独评估。

18 岁不套 ≥19 方程，使用原生 15–<19 岁查表：

| 性别 | PAL 1.4 | 1.6 | 1.8 |
| --- | ---: | ---: | ---: |
| 男 | 2600 | 3000 | 3400 |
| 女 | 2000 | 2300 | 2600 |

该年龄路径要求 PAL 恰好为表中值。依据：[能量 FAQ](https://www.dge.de/gesunde-ernaehrung/faq/energiezufuhr/)、[能量参考表](https://www.dge.de/wissenschaft/referenzwerte/energie/)。

### 4.3 瑞士 BLV：`ch_table`

瑞士自 2022 年后采用自己的 BLV 参考体系，不再将现行 DACH 当作完全相同的一套参数。按官方网站成人与 >65 岁动态表：

| 完整年龄 | 男 kcal/day | 女 kcal/day | 区间背景 |
| --- | --- | --- | --- |
| 18–65 | 2305–2672 | 1861–2147 | 整个年龄组、PAL 1.6 |
| ≥66 | 2100–2800 | 1700–2100 | 老年组、PAL 1.4–1.8 |

区间按原样返回，不能取中点、按输入的 PAL 线性插值、或按身高体重擅自“个性化”。若要个体能量，可明确覆盖为 `dge_ree`、`henry2005`、`nasem2023`、`mifflin1990` 或已提供的能量；此时营养素仍来自 BLV，能量来源另标。

依据：[BLV 参考值说明](https://www.blv.admin.ch/de/naehrstoffzufuhr)、[官方动态表](https://kwk.blv.admin.ch/naehrstofftabelle-en/)。官方表查询分别使用 `categoryId=18years` 和 `65years`；后者网页标题实际为“66 years and over”，本核心采用 **66** 的分界。它不是 65 岁起的 DGE 蛋白质分界。

### 4.4 中国 DRIs 2023：`cn_table`

原生路径按中国营养学会成人男女原表查 MJ，然后使用 `MJ×1000/4.184`。这些是群体参考 EER，不是把实际体重带入的个体方程。表中 MJ 已有舍入，换算后的很多小数不代表生理精度。

| 完整年龄 | PAL（轻／中／重） | 男 MJ/day（轻／中／重） | 女 MJ/day（轻／中／重） |
| --- | --- | --- | --- |
| 18–29 | 1.5 / 1.75 / 2.0 | 9.00 / 10.67 / 12.55 | 7.11 / 8.79 / 10.25 |
| 30–49 | 1.4 / 1.7 / 2.0 | 8.58 / 10.46 / 12.34 | 7.11 / 8.58 / 10.04 |
| 50–64 | 1.4 / 1.7 / 2.0 | 8.16 / 10.04 / 11.72 | 6.69 / 8.16 / 9.62 |
| 65–74 | 1.4 / 1.7 / 无 | 7.95 / 9.62 / 无 | 6.49 / 7.74 / 无 |
| ≥75 | 1.4 / 1.7 / 无 | 7.53 / 9.20 / 无 | 6.28 / 7.32 / 无 |

65 岁起重体力项未定义，不外推。原表没有的 PAL 不插值。依据：[原表目录：表 9–12](https://www.cnsoc.org/drpostand/)、[表 13–14、20–23](https://www.cnsoc.org/drpostand/page2.html)。

### 4.5 美国／加拿大 NASEM 2023：`nasem2023`

**它直接输出全天 EER，不是 BMR。**输入 A 岁、H cm、W 实际 kg。PAL 仅用于选择活动类别，方程算完绝不再乘 PAL。

19 岁起：`E = c0 + cA×A + cH×H + cW×W`。

| 性别 | 活动类别 | c0 | cA | cH | cW |
| --- | --- | ---: | ---: | ---: | ---: |
| 男 | inactive | 753.07 | −10.83 | 6.50 | 14.10 |
| 男 | low_active | 581.47 | −10.83 | 8.30 | 14.94 |
| 男 | active | 1004.82 | −10.83 | 6.52 | 15.91 |
| 男 | very_active | −517.88 | −10.83 | 15.61 | 19.11 |
| 女 | inactive | 584.90 | −7.01 | 5.72 | 11.71 |
| 女 | low_active | 575.77 | −7.01 | 6.60 | 12.14 |
| 女 | active | 710.25 | −7.01 | 6.54 | 12.34 |
| 女 | very_active | 511.83 | −7.01 | 9.07 | 12.56 |

18 岁使用 14–18 岁原方程，并包含原文 **+20 kcal/day 生长项**。下面 c0 已加入这 20，不能再加一次：

| 性别 | 活动类别 | c0（含 +20） | cA | cH | cW |
| --- | --- | ---: | ---: | ---: | ---: |
| 男 | inactive | −427.51 | 3.68 | 13.01 | 13.15 |
| 男 | low_active | 39.12 | 3.68 | 8.62 | 20.28 |
| 男 | active | −368.19 | 3.68 | 12.66 | 20.46 |
| 男 | very_active | −651.75 | 3.68 | 15.38 | 23.25 |
| 女 | inactive | 75.59 | −22.25 | 8.43 | 17.07 |
| 女 | low_active | −277.54 | −22.25 | 12.77 | 14.73 |
| 女 | active | −169.55 | −22.25 | 11.74 | 18.34 |
| 女 | very_active | −689.59 | −22.25 | 18.22 | 14.25 |

| 年龄 | inactive PAL | low_active | active | very_active |
| --- | --- | --- | --- | --- |
| 18 | [1,1.56) | [1.56,1.73) | [1.73,1.92) | [1.92,2.5) |
| ≥19 | [1,1.53) | [1.53,1.68) | [1.68,1.85) | [1.85,2.5) |

边界直接按原表使用左闭右开，连续 PAL 唯一映射；不把 PAL=1.60 解释成旧版 IOM 方程的 PA 系数 1.11／1.12。

依据：[Health Canada 公布的 NASEM 2023 全套方程与活动分类，2025-11-19 页面](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/equations-estimate-energy-requirement.html)。

### 4.6 可独立选择的其他能量方法

`provided`：输入 `{method:'provided',kcal:数值或{low,high},label:'来源与用途'}`。所有能量必须为正；区间必须有序。可承接实测／外部专业计划，或临床模块结果。`label` 必填，以免混淆维持能量与减重目标。

`mifflin1990`：原论文未舍入的 REE 方程，S 男=1、女=0：

```text
REE = 9.99W + 6.25Hcm − 4.92A + 166S − 161
E = REE × 显式 PAL
```

常见简化版 `10W+6.25H−5A+5/−161` 不是本核心使用的原系数。原论文是静息能量方程，乘 PAL 是另行指定的全天估算步骤；不声称它是四地共同的官方算法。原验证样本 19–78 岁，超出该年龄范围返回 `out_of_scope`。[Mifflin 1990 原论文](https://pubmed.ncbi.nlm.nih.gov/2305711/)

`henry2005`：使用英国 SACN 公布的 Henry **体重＋身高、MJ** 系数：

```text
BMR_MJ = a×Wkg + b×Hmetres + c
E_kcal = BMR_MJ × 1000/4.184 × 显式 PAL
```

| 性别 | 本实现年龄分段 | a | b | c |
| --- | --- | ---: | ---: | ---: |
| 男 | [18,30) | 0.0600 | 1.31 | 0.473 |
| 男 | 30–60（含60） | 0.0476 | 2.26 | −0.574 |
| 男 | >60 | 0.0478 | 2.26 | −1.070 |
| 女 | [18,30) | 0.0433 | 2.57 | −1.180 |
| 女 | 30–60（含60） | 0.0342 | 2.10 | −0.0486 |
| 女 | >60 | 0.0356 | 1.76 | 0.0448 |

原表写 18–30、30–60、>60；本实现明确将重复的 30 岁边界归入 30–60，60 岁保留在该行，61 岁起进入 >60 行。MJ 与独立舍入的 kcal 系数列不完全相同，本实现只选 MJ 一列。它是显式独立的 Henry 方法，不冒称已经逐项复现 EFSA 内部全部参考体型推导。[SACN 2011，Appendix 4 Table 18](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/339317/SACN_Dietary_Reference_Values_for_Energy.pdf)

## 5. 六个地区参考体系：八项营养量

下面所有百分比都乘以本次**明确的全天 E**，再按第 3 节换算克数和分配到午晚餐。更换 E 不会缩减固定克数的纤维 AI、蛋白质 PRI/RDA 或钠 AI。若能量未确定，固定参考仍可输出，能量依赖项返回缺输入。

### 5.1 EFSA

| 项目 | 全天定义 | 输出语义 |
| --- | --- | --- |
| 能量 | 第 4.1 节 | 群体 AR |
| 蛋白质 | 0.83×Wr g | PRI |
| 碳水 | 45–60 E% | RI |
| 总脂肪 | 20–35 E% | RI |
| 饱和脂肪 | 在营养充分前提下尽可能低 | `qualitative`；不制造 10% 上限 |
| 糖 | 添加糖／游离糖尽可能低；未制定可数值化 UL | 总糖 `not_comparable`；不制造 10% 上限 |
| 盐 | 钠 2000 mg ⇒盐当量 5 g | safe and adequate reference，**不是盐上限** |
| 纤维 | 25 g | AI |

依据：[蛋白质 2012](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2012.2557)、[碳水／纤维 2010](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2010.1462)、[脂肪 2010](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2010.1461)、[钠 2019](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2019.5778)、[糖 2022](https://efsa.onlinelibrary.wiley.com/doi/10.2903/j.efsa.2022.7074)。若要 WHO 的盐／糖限制，须明确选择或注明补充来源。

### 5.2 DGE/ÖGE（现行德奥参考，不能直接等同瑞士）

| 项目 | 全天定义 | 输出语义 |
| --- | --- | --- |
| 能量 | 第 4.2 节 | 个体估算／18 岁群体参考 |
| 蛋白质 | 18 岁男 0.9×Wr、女 0.8×Wr；19–64 岁 0.8×Wr；≥65 岁 1.0×Wr g | 推荐摄入；≥65 岁为估计值 |
| 碳水 | >50 E% | 最少供能建议；不是 50–65% |
| 总脂肪 | 约 30 E% | 参考点，不是严格最大值；高 PAL 可有不同安排 |
| 饱和脂肪 | 限制至约 7–10 E%，计算用 ≤10 E% | 7% **不是需要吃到的下限** |
| 糖 | 游离糖 <10 E% | 当前总糖不能比较 |
| 盐 | 钠 AI 估计 1500 mg ⇒3.75 g 盐当量；另有食盐 ≤6 g 建议 | 两项并列，3.75 g 不是最低盐需要 |
| 纤维 | ≥19 岁 ≥30 g；18 岁无正式全天定量指南 | 18 岁 `not_defined` |

DGE 纤维表附注有 14.6 g/1000 kcal 的解释性密度，但明确不等同正式指南；不将其偷换成 18 岁也一律 30 g。本实现保留说明，没有把它作为定量目标。

依据：[蛋白质](https://www.dge.de/wissenschaft/referenzwerte/protein/)、[碳水](https://www.dge.de/wissenschaft/referenzwerte/kohlenhydrate/)、[脂肪](https://www.dge.de/wissenschaft/referenzwerte/fett-essenzielle-fettsaeuren/)、[脂肪指南 FAQ](https://www.dge.de/gesunde-ernaehrung/faq/fettleitline/)、[游离糖共识 2018](https://www.dge.de/fileadmin/dok/gesunde-ernaehrung/ernaehrungsempfehlung/10-regeln/Konsensuspapier_Zucker_DAG_DDG_DGE_2018.pdf)、[纤维及附注 b](https://www.dge.de/wissenschaft/referenzwerte/ballaststoffe)、[钠](https://www.dge.de/wissenschaft/referenzwerte/natrium/)、[盐建议](https://www.dge.de/gesunde-ernaehrung/gut-essen-und-trinken/dge-empfehlungen/suesses-salziges-und-fettiges)。

### 5.3 瑞士 BLV

| 项目 | 18–65 岁 | ≥66 岁 |
| --- | --- | --- |
| 能量 | 第 4.3 节群体区间 | 同左，采用老年区间 |
| 蛋白质 | 0.83×Wr g | **1.0–1.2×Wr g** |
| 碳水 | 45–60 E% | **45–65 E%** |
| 总脂肪 | 20–35 E% | 20–35 E% |
| 饱和脂肪 | <10 E% | <10 E% |
| 游离糖 | ≤10 E%，总糖不可比较 | 同左 |
| 盐 | 钠 AI 2000 mg ⇒5 g；另有盐 ≤5 g 公共建议 | **钠 AI 1200–1500 mg ⇒3.0–3.75 g**；另有盐 ≤5 g 建议 |
| 纤维 | ≥30 g AI | **25–30 g AI**，不是 30 g 毒性上限 |

蛋白质原表类型为 PRI，包括老年区间。老年表注释对营养不良风险／衰弱者还有不同蛋白质建议；不纳入本轮健康老人默认值。依据：[官方动态表](https://kwk.blv.admin.ch/naehrstofftabelle-en/)、[BLV 盐建议](https://www.blv.admin.ch/de/salzreduktion)。糖的口径还通过 [SGE 2023 官方课件第 6 页](https://www.sge-ssn.ch/media/ct_protected_attachments/1938d4c4817bdb753412b6dc80881e/Kohlenhydrate-2023.pdf)核对：游离糖包含添加糖以及蜂蜜、糖浆、果蔬汁／浓缩汁中的糖，并非全部食物总糖。

### 5.4 中国 DRIs 2023

| 项目 | 18–64 岁 | 65–74 岁 | ≥75 岁 |
| --- | --- | --- | --- |
| 能量 | 第 4.4 节 | 第 4.4 节 | 第 4.4 节 |
| 蛋白质 RNI，男／女 | 65／55 g | **72／62 g** | **72／62 g** |
| 蛋白质 AMDR | 10–20 E% | **15–20 E%** | **15–20 E%** |
| 碳水 | 50–65 E% | 同左 | 同左 |
| 总脂肪 | 20–30 E% | 同左 | 同左 |
| 饱和脂肪 | <10 E% | 同左 | 同左 |
| 添加糖 | <10 E%，总糖不可比较 | 同左 | 同左 |
| 钠 AI | 1500 mg | 1400 mg | 1400 mg |
| 钠 PI | ≤2000 mg | ≤1900 mg | ≤1800 mg |
| 纤维 | 25–30 g AI | 同左 | 同左 |

蛋白质 RNI 与 AMDR 是两条不同参考，均返回，不取交集、不取平均、不互相覆盖。钠两个参考均乘 0.0025 转盐当量；不能由 PI 再生成所谓最少盐摄入量。依据是第 4.4 节列出的原始年龄／性别表，非仅用年轻人表外推全部成人。

### 5.5 NASEM DRI（美国／加拿大）

| 项目 | 全天定义 |
| --- | --- |
| 能量 | 第 4.5 节 NASEM 2023 EER |
| 蛋白质 RDA | 18 岁 0.85×Wr g；≥19 岁 0.8×Wr g |
| 蛋白质 AMDR | 18 岁 10–30 E%；≥19 岁 10–35 E% |
| 碳水 | 45–65 E% AMDR；另保留 RDA 130 g |
| 总脂肪 | 18 岁 25–35 E%；≥19 岁 20–35 E% |
| 饱和脂肪 | 营养充分前提下尽可能低；没有数值 UL |
| 糖 | 2005 DRI 的添加糖 ≤25 E% 是避免排挤其他营养的历史性建议，**不是 UL，也不是最新 DGA 的每餐规则**；总糖不可比较 |
| 盐 | 钠 AI 1500 mg ⇒3.75 g；CDRR 2300 mg ⇒5.75 g，分别保留 |
| 纤维 | 男 18–50 岁 38 g，≥51 岁 30 g；女 18 岁 26 g，19–50 岁 25 g，≥51 岁 21 g；均为 AI |

依据：[官方宏量参考表](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/reference-values-macronutrients.html)、[2019 钠 AI／CDRR 表](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/reference-values-elements.html)。不把旧的钠 UL 误当现行 CDRR。

### 5.6 DGA 2025–2030（独立美国政策指南）

| 项目 | 本版可定量规则 |
| --- | --- |
| 能量 | 显式另选能量方法；不冒称本版提供独立 EER 公式 |
| 蛋白质 | 1.2–1.6×实际 W g/day |
| 总脂肪／碳水／纤维 | 本核心不把 NASEM 的数值冒充本版自有规则，返回 `not_defined` |
| 饱和脂肪 | ≤10 E% |
| 添加糖 | **每餐 ≤10 g**；daily 容器中的 reference 仍标 `period:'meal'` |
| 盐 | 钠 <2300 mg/day ⇒盐当量 <5.75 g/day |

所有来源均标 DGA 2025–2030，不把 1.2–1.6 写成 NASEM 已修改 RDA。若界面将本版蛋白质加上 NASEM 的其他项目，必须明确称为组合方案并保留各自来源。[正式文件，2026 发布](https://cdn.realfood.gov/DGA.pdf)

## 6. WHO 补充体系

`who` 需显式指定能量来源。蛋白质未给出本范围内的统一数字，返回 `not_defined`；碳水规定质量，返回 `qualitative`。

| 项目 | 全天规则 |
| --- | --- |
| 总脂肪 | ≤30 E%；这里不添一个未经本规则规定的 20% 下限 |
| 饱和脂肪 | ≤10 E% |
| 游离糖 | 常规 <10 E%；`whoSugarLevel:'conditional_5_percent'` 选择有条件的 <5 E% 进一步获益建议 |
| 盐 | <5 g（钠 <2000 mg） |
| 纤维 | ≥25 g，自然存在于食物中的膳食纤维 |

不把 <5% 有条件建议写成所有成人的强制阈值。依据：[WHO 2023 脂肪／碳水指南](https://www.who.int/news/item/17-07-2023-who-updates-guidelines-on-fats-and-carbohydrates)、[健康膳食与糖建议](https://www.who.int/health-topics/healthy-diet)、[钠](https://www.who.int/news-room/fact-sheets/detail/sodium-reduction)。

## 7. 运动营养：三个窄体系

这些是运动营养立场文件，不是所有健康人的“更严格医学上限”。未明确给出的八项数值保持 `not_defined`，不能把运动补水／补盐量简化成所有训练者统一盐目标。能量仍需显式方法，不能仅凭训练小时数猜能量消耗。

### 7.1 DGE 运动蛋白质 2020：`dge_sport`

输入实际体重 W 与 `training.weeklyHours`。**每周训练 >5 小时**适用蛋白质 1.2–2.0×W g/day。≤5 小时该运动范围返回 `out_of_scope`，应选择普通 DGE 年龄参考，而不是自动给全部健身者抬高蛋白质。其余营养项目本窄模块未定量。

午晚餐默认仍需明确分配；例如显式 40%／30% 时，午餐为 0.48–0.80×W，晚餐 0.36–0.60×W g。这是数学投影，不是原立场专门研究的午晚餐处方。[DGE 原立场说明](https://www.dge.de/presse/meldungen/2020/positionspapier-zur-proteinzufuhr-im-sport/)

### 7.2 ISSN 蛋白质 2017：`issn`

健康训练者全天 1.4–2.0×实际 W g。`proteinMealStrategy` 有三个互斥选项：

| 选择 | 午餐蛋白质 | 晚餐蛋白质 |
| --- | --- | --- |
| 缺省或 `proportional` | 全天范围 × alphaL | 全天范围 × alphaD |
| `issn_weight_dose` | 每次约 0.25×W g | 每次约 0.25×W g |
| `issn_absolute_dose` | 每次 20–40 g | 每次 20–40 g |

后两者是立场文件给出的**替代性单次高质量蛋白质建议**；不是必须同时达到的两套条件，不是人体每餐最多吸收 40 g。原文还讨论年龄、蛋白质量、训练等因素，以及约每 3–4 小时分布；软件不能仅靠两餐保证全天最优分布。单次值没有再乘午晚餐份额，也没有承诺两餐合计等于全天范围。

减脂抗阻训练中特定人群的高蛋白／去脂体重建议不作为普通减重默认，本轮没有实现竞技或严格低能量可用性的个体处方。[ISSN 原文](https://doi.org/10.1186/s12970-017-0177-8)

### 7.3 AND/DC/ACSM 2016：`acsm`

蛋白质 1.2–2.0×实际 W g/day；总脂肪 20–35 E%；训练碳水按**当前训练日**选择，不由周运动小时粗略推断：

| `training.carbohydrateLoad` | 适用描述 | 碳水 g/kg/day |
| --- | --- | --- |
| `low` | 低强度／技巧类活动 | 3–5 |
| `moderate` | 约 1 h/day 中等训练 | 5–7 |
| `high` | 1–3 h/day 中高强度耐力 | 6–10 |
| `very_high` | >4–5 h/day 很高训练负荷 | 8–12 |

碳水克数 `W×[下端,上端]`，然后按明确的 alphaL／alphaD 分配。其余饱和脂肪、糖、盐、纤维不冒造竞技统一克数。运动前后／赛中补给和低能量可用性诊断不在本接口范围。[原联合立场](https://pubmed.ncbi.nlm.nih.gov/26920240/)、[DGE 运动碳水立场表 1](https://www.dge.de/fileadmin/dok/gesunde-ernaehrung/gezielte-ernaehrung/sportler-innen/EU11_2019_M660_M667.pdf)、[NIH ODS 运动专业资料](https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/)

## 8. 减重临床指南：能定义多少就计算多少

`energy` 在下面三个体系中表示**干预前维持能量**，`clinicalPlan` 表示干预方案。不要传入已减过一次的目标热量再减第二次。除中国五条路径中不依赖维持 E 的独立方法外，缺维持 E 就不能计算。

### 8.1 NICE NG246：`nice_ng246`

输入明确的 `clinicalPlan:{kind:'deficit_kcal',amount:D}`，D 为正数或正区间。NICE 规定要形成能量缺口并个体化，但没有要求所有人用统一 500 kcal；软件不默认 500。

```text
E目标 = E维持 − D
若维持 E∈[EL,EU]，D∈[DL,DU]：E目标∈[EL−DU, EU−DL]
```

NICE 本身不提供本应用所需完整八项克数处方，所以蛋白质、总脂肪、碳水、饱和脂肪、糖、盐、纤维均 `not_defined`，可在后续显式组合一个地区参考。低能量方案 800–1200 kcal/day 需有支持的专业服务，<800 需选定的专业管理，核心会注明，不能把这些数值当普通减重默认目标。[NG246 dietary approaches](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)

### 8.2 德国肥胖 S3 2024：`dag_s3_2024`

原指南 recommendation 5.11 给出约 **500–600 kcal/day 或个体化确定的缺口**：

- `clinicalPlan:{kind:'guideline_deficit'}` → `E目标∈[E维持−600,E维持−500]`。
- `{kind:'deficit_kcal',amount:D}` → 使用明确的个体缺口。

保留区间，不取 550 当成标准唯一值。该指南还有第 4 章预防建议：4.9 游离糖 <10 E%，4.8 推荐高纤维膳食。核心保留糖的相关分析物预算与定性纤维建议，并注明第 4 章来源；并非把原生糖建议漏掉。

4.10c 允许使用 DGE 宏量参考作方向，但不要求所有减重方案强制同一比例。`s3MacroPolicy` 缺省／`individualized` 时，蛋白质、脂肪、碳水返回定性个体化建议；明确选择以下之一时可计算原文引用的定量方向：

| `s3MacroPolicy` | 蛋白质 | 总脂肪 | 碳水 |
| --- | --- | --- | --- |
| `dge_general` | ≤65 岁 0.8×Wr，>65 岁 1.0×Wr g | ≤30 E% | >50 E% |
| `dge_physically_active` | 同左 | ≤35 E%（明确选择身体活动者） | >50 E% |

这里严格保留 **S3 2024 文本**“bis 65／über 65”的年龄表达，与现行独立 DGE 蛋白质表“65 岁起”有边界差别，不能静默混成一版。高强度训练蛋白质另见运动模块。S3 关于可降低碳水比例的背景条件还提到纤维 >30 g、饱和脂肪 <10 E% 等；它们有特定适用前提，不作为所有减重方案的自动硬性处方。本轮未实现低碳／极低热量治疗方案。

盐没有该通用减重模块的统一克数；饱和脂肪没有脱离具体策略的独立新数值。其他未定义项目不自动按“节食比例”削减。[S3 原文，2024-10，4.8–4.10（pp.89–98）、5.11（pp.141–142）](https://register.awmf.org/assets/guidelines/050-001l_S3_Praevention-Therapie-Adipositas_2024-10.pdf)

### 8.3 中国成人肥胖食养指南 2024：`cn_obesity_2024`

这是针对成人超重／肥胖的食养指导，不作为正常体重人群的通用减重处方。所有路径先要求实际 W、H 以确认中国 BMI≥24，缺测量返回缺输入，BMI<24 全模块返回 `out_of_scope`。五条能量路径是原文允许**任选其一**的替代方案，不能叠加：

| `clinicalPlan.kind` | 必要额外输入 | 目标 kcal/day |
| --- | --- | --- |
| `guideline_fraction` | 维持／所选参考 E | E×[0.50,0.70]，即降低 30–50% |
| `guideline_deficit` | 同上 | [E−1000,E−500] |
| `sex_band` | 性别 | 男 1200–1500；女 1000–1200 |
| `bmi_reduction` | 实际 W、H、实际维持 E、明确 BMR `restingKcal` | 中国 BMI 24–<28：0.85E；≥28：0.80E；必须高于 BMR |
| `ideal_weight` | H、活动类、明确 `kcalPerIdealKg` | (Hcm−105)×活动 kcal/kg |

`ideal_weight` 的活动因子：卧床 `bed_rest`=15，轻 `light`=20–25，中 `moderate`=30，重 `heavy`=35。调用者必须给出该类别内的一个数或有序区间，不暗选 22.5。该理想体重算法只属于此指南，不写回通用 `referenceWeightKg`。

`bmi_reduction` 若 BMI<24 返回 `out_of_scope`；缺 BMR 返回缺输入；目标不高于 BMR 时抛出范围错误，不偷偷抬高或截断到某个热量。其余区间若出现非正能量也报错，不把负值改成 0。

| 营养项目 | 该指南的全天规则 |
| --- | --- |
| 蛋白质 | 15–20 E% |
| 总脂肪 | 20–30 E% |
| 碳水 | 50–60 E% |
| 饱和脂肪 | 没有单独给出本模块可用克数阈值，`not_defined` |
| 添加糖 | **最好 <25 g/day**，是优选建议；总糖不能直接比较 |
| 盐 | ≤5 g/day |
| 纤维 | 增加富含纤维食物，未给出独立克数要求，`qualitative` |

原生三餐供能比 3:4:3 可以显式选择 `allocation:{kind:'cn_obesity_343'}`。在 E=1500 时，午餐 E=600、晚餐 E=450；午餐 P=22.5–30 g、F=13.333…–20 g、C=75–90 g；晚餐 P=16.875–22.5 g、F=10–15 g、C=56.25–67.5 g。添加糖的投影分别是优选 <10 g 和 <7.5 g，盐 ≤2 g 和 ≤1.5 g；这些固定项目的餐次分配属于本应用规划假设。

原文另有烹调油 20–25 g 等食品建议，**烹调油不等于总脂肪**，没有把它写到 `fat`。[卫健委 2024 原 PDF，正文 pp.5–7](https://www.cnsoc.org/images/@cmsxh_7108bb5a-13de-4356-a2a9-50d178413c39.pdf)

## 9. Hall 2011 动态能量模型

这是公开论文模型的本地复现，作为独立能量规划工具；**不是**声称与当前 NIH Body Weight Planner 各版本逐位一致，也不是完整营养标准。没有从减重期限简单套“每公斤固定 7700 kcal”。

原文：[Hall 等 2011 论文附录，equations 1–9](https://www.niddk.nih.gov/-/media/Files/BWP/Hall_Lancet_Web_Appendix.pdf)。实现见 [hall.mjs](./hall.mjs)，接口见 [core.d.mts](./core.d.mts)。

### 9.1 必需输入与初始化

共用 profile 需要成人年龄、实际 W、PAL；如果没有提供脂肪量还需要性别、H 来估算体脂。PAL 使用 [1.2,2.5] 的本工具输入范围。

```js
const model = createHallModel(profile, {
  maintenanceEnergyKcal: E0,  // 已有的基线维持能量
  carbohydrateKcal: CI0,     // 基线碳水 kcal/day，必须明确提供
  ecfLitres: ECF0,           // 初始细胞外液 L，必须明确提供
  glycogenKg: G0             // 可省略，论文近似初始糖原 0.5 kg
});
```

不根据体重假定 ECF=20%、不猜基线碳水 50%。这些是 Hall 所需的额外状态资料；当前网站不记录饮食时，用户未提供就不能得到有依据的个人反算。例子中的 ECF 和碳水值仅为演示，不是用户默认值。

缺少实测脂肪量时按附录 equation 4 的 Jackson 估算：

```text
BMI = W / (Hcm/100)²
男 F0 = W/100 × (0.14A + 37.31 ln(BMI) − 103.94)
女 F0 = W/100 × (0.14A + 39.96 ln(BMI) − 102.01)
L0 = W − F0 − ECF0 − 3.7G0
AT0 = 0
```

F、L、G 的单位 kg；ECF 以水密度 1 kg/L 表示。L 是模型的结构性瘦组织变量，不是一般体脂秤显示的“去脂体重”。任一初始隔室不为正则拒绝计算。

### 9.2 常数与微分方程

以下统一用 kcal、kg、L、day、mg；原文 kJ 转换均除以 4.184：

```text
rhoG=17600/4.184；rhoF=39500/4.184；rhoL=7600/4.184   [kcal/kg]
gammaF=13/4.184；gammaL=92/4.184                     [kcal/kg/day]
etaF=750/4.184；etaL=960/4.184                       [kcal/kg]
betaTEF=0.1；betaAT=0.14；tauAT=14 day
Na浓度=3220 mg/L；xiNa=3000 mg/L/day；xiCI=4000 mg/day
每 kg 糖原结合水=2.7 kg；Forbes 常数=10.4 kg
```

令 EI 为干预摄入 kcal/day，CI 为干预碳水 kcal/day，ΔNa 为相对基线的钠摄入改变，Δδ 为活动参数改变：

```text
dG/dt = [CI − (CI0/G0²)G²] / rhoG
dECF/dt = [ΔNa − xiNa(ECF−ECF0) − xiCI(1−CI/CI0)] / 3220
C = 10.4 rhoL/rhoF
p = C/(C+F)
BW = F + L + ECF + 3.7G
dF/dt = (1−p)(EI−EE−rhoG*dG/dt)/rhoF
dL/dt = p(EI−EE−rhoG*dG/dt)/rhoL
dAT/dt = [0.14(EI−E0)−AT]/14
```

基线校准与能量消耗：

```text
RMR0 = E0/PAL
δ0 = (0.9PAL−1)RMR0/W0
K = E0 − gammaF*F0 − gammaL*L0 − δ0*W0
TEFchange = 0.1(EI−E0)
eta = p*etaL/rhoL + (1−p)*etaF/rhoF
EE = [K + gammaF*F + gammaL*L + (δ0+Δδ)*BW
      + TEFchange + AT + (EI−rhoG*dG/dt)*eta] / (1+eta)
```

最后一式是附录 equation 9 对组织合成消耗的闭式处理；TEF 是相对基线的改变，不能在 K 已校准后又额外加整个 EI 的 10%。

### 9.3 正向与反向求解

`simulateHall` 使用固定步长四阶 Runge–Kutta；默认 0.25 day，允许 [1/1024,0.5] day，最后不足一步按实际时长积分，最多默认 1,000,000 步。干预中任何隔室非正会报错，不以裁剪负值掩盖离开模型范围。

```js
simulateHall(model, {
  energyKcalPerDay: EI,
  carbohydrateKcalPerDay: CI,
  sodiumChangeMgPerDay: deltaNa,
  activityChangeKcalPerKgDay: deltaActivity
}, { days: 90, stepDays: 0.25 });
```

`planHallEnergy` 对**常量** EI 进行二分反算，调用者必须给出目标体重、天数、摄入搜索上下界、碳水供能比例、钠改变、活动改变。默认摄入区间误差停止条件 0.05 kcal/day。目标不在搜索端点对应的体重之间时返回 `target_not_bracketed`，不随便返回搜索边界当作达标方案。所有分隔室正性与能量输入仍需满足。

求出的 `energyKcalPerDay` 可以作为 `provided` 显式传入地区营养参考；Hall 自身不产生蛋白质、盐、纤维处方。原模型的数值复现没有完成个体临床验证；基线 ECF、饮食构成和代谢估计的不确定性不能由把二分误差调得更小来消除。

## 10. 输出、调用与后续集成约定

```js
const r = calculateTargets({
  standard: 'us_nasem',
  profile: { ageYears: 30, sex: 'male', heightCm: 180,
             weightKg: 75, activity: { pal: 1.6 } },
  allocation: { kind: 'explicit', lunch: 0.4, dinner: 0.3 }
});
```

同一结果有 `daily`、`lunch`、`dinner` 三个八字段对象。每个 reference 保存：数值区间 `amount`、原术语 `referenceType`、数学关系 `kind`、公式、来源 ID、周期；餐次投影还保存 `dailyAmount`、`share` 和 `projection`。所有来源 ID 在 `SOURCES` 中有标题、版本和 URL。DGA 每餐糖参考虽在 daily 容器中也可查到，但 `period` 仍为 meal，不可汇总成日上限。

上例 EER=2871.07 kcal/day，午 1148.428、晚 861.321。蛋白质 RDA=60 g/day，午 24、晚 18；蛋白质 AMDR 日 71.77675–251.218625 g，午 28.7107–100.48745、晚 21.533025–75.3655875。两个 reference 都保留。纤维 AI=38 g/day，午 15.2、晚 11.4；CDRR 盐当量=5.75 g/day，午预算 2.3、晚 1.725 g。它们都不是单餐诊断界线。

组合方案必须显式且保留来源。例如先用德国 S3 计算能量，再将该结果通过 `energy:{method:'provided',kcal:...,label:'S3 plan ...'}` 给 EFSA。不要偷偷把“各国最严格值”拼成新标准；运动蛋白质也不能不说明就替换原标准 PRI，并继续声称所有原宏量比例必然同时满足。示例代码展示了显式组合，没有实现用户界面切换策略。

糖输出的 `Metric.analyte` 是网站 `total_sugars`，相关 reference 的 `analyte` 是 `added_sugars`、`free_sugars` 等，且 `status:'not_comparable'`。接入餐点数据前不要抹掉该状态。即使总糖较低可以形成某些数学界限，也不能把它当作已测得添加糖／游离糖，或给出精确的差额。

没有食物日志时，无法判断全天是否已超标；只可以说本餐相对**已选计划预算**高／低。PRI、AI、AMDR、定性建议、数值限制和缺失值应分别显示，不把所有项目都画成同一条“达到 100% 后变红”的规则。本轮按用户要求不实现这些视觉与比较逻辑。

## 11. 验证、性能与维护

运行命令见 [README](./README.md)。测试覆盖：原公式代表数值；18／19、65／66、75、80 等年龄边界；PAL 边界；中国年龄表；瑞士区间；参考体重；午晚餐份额与未分配余额；DGA 原生每餐糖；糖分析物不一致；RDA／AMDR 并存；五条中国肥胖能量路径；固定参考不因减能量而缩减；缺输入／非法输入／不适用的区别；结果与参数不互相修改。

Hall 验证包括全年基线平衡、储存能变化与积分能量缺口守恒、步长减半收敛、由正向目标反算摄入，以及无可行区间的返回。这是数值与实现检查，不是与当前 NIH 网页或临床个体结果的等价验证。

常规目标是个人资料／标准／分配设置变更时计算一次，然后供所有餐点复用；不需要每个餐点重新求人体目标。当前环境 Node v24.19.0 测量 10,000 次 NASEM 全天＋午晚餐完整输出约 1.01 秒（约 0.10 ms/次）；真实 Chromium 154 的同类测量约 0.13 ms/次，代表数值与 Node 一致，模块加载没有外部请求。Hall 90 天目标反算在 Node 约 56 ms。这个测量不是移动浏览器承诺；Hall 反算可放 Web Worker，常规核心很适合本地使用。详见 [验证记录](./VALIDATION.md)。

标准更新时应分别更新版本、来源、原始数据和边界测试，不静默替换系数。EFSA 网页 JSON 与 BLV 动态表是本次核查的资料来源，不是软件运行时依赖，也不当作有长期契约的公开计算 API。所有原文链接与本地事实表均为截至核查日的固定版本。
