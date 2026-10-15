# 苏黎世 ETH 菜品份重：现有应用与开源方案调查

调查日期：2026-10-14（Europe/Zurich）。问题范围严格限定为 ETH 苏黎世 Polyterrasse / FUSION 等 Cookpit 菜品的整份重量。Basel 和 UZH 的 FOOD2050 重量不算解决这个问题。本次只读查询公开源码、仓库 issue 和作者页面，没有联系他人，没有修改抓取实现。

## 结论

**Polyterrasse、Clausiusbar 和 Food market 已实际取得份重和整份营养：来源是 SV 官方公开菜单的新 Qnips 网站。** 2026-10-14 Polyterrasse 五道主菜与 Cookpit 的日期、菜单线、菜名和配菜描述完全对应；这满足本次苏黎世范围，具体结果见下节。FUSION 由另一运营商供餐，此结果不能自动推广至 FUSION。

**已核查的公开开源项目仍未发现现成的 ETH 苏黎世份重实现。** Android 应用讨论过同一个问题，当前代码采用 ETH 每 100 g、UZH 每份展示。因此现有应用的「已支持营养」不等于 ETH 重量已经解决；但其此前的结论也不能排除这次确认的 SV 新来源。

这是一项有明确搜索范围的负面结果，不是对所有私人项目、未公开接口或运营商内部数据的存在性断言。

## 新确认的可用来源：SV / Qnips 的 Polyterrasse 公共菜单

Polyterrasse 的 SV 旧站当前跳转至 [SV 官方 Polyterrasse 菜单](https://sv-gastronomie.ch/menu/ETH,%20Polyterrasse,%20Z%C3%BCrich)。其公开前端的[菜品详情组件](https://sv-gastronomie.ch/chunk-BPZYMXIL.js)展示 `WeightInGrams`、`NutritionFacts.KCalPerServing` 等字段。主调查进程沿着该公共网站正常的访客流程取得了**实际菜单文档**；不是仅凭通用 UI 字段猜测餐厅有数据。

验证的门店为 `StoreId=42009`（ETH, Polyterrasse, Zürich），午餐 `MenuCardId=18509`，公开发布数据路径为 `/Release/de-CH/Menus/18509/Years/2026/Weeks/42`。返回七个日历日、28 个商品条目，其中 **23 个条目同时有正值份重和营养数据**；五个自选 Hot & Cold Buffet 条目重量为 0、无营养对象，不能当作实际零重量或填充整份营养。

2026-10-14 的实际记录：

| 菜单线 / 菜名 | Cookpit `line-id` | SV 商品 ID | `WeightInGrams` | `KCalPerServing` | `ProteinsPerServing` |
| --- | --- | --- | --- | --- | --- |
| LOCAL / Piccata Milanese | 78563 | 23701014 | 600 g | 685 kcal | 48.20994 g |
| STREET / Cheese Burger | 78564 | 23701018 | 465 g | 1037 kcal | 35.8462639 g |
| VEGAN / Rigatoni con Polpettine | 78565 | 23701023 | 456 g | 552 kcal | 29.6409874 g |
| GARDEN / Ur-Kartoffeln Szegediner Art | 78566 | 23701005 | 636 g | 732 kcal | 19.9001789 g |
| HOME / Poulet Yassa | 78567 | 23701010 | 588 g | 863 kcal | 48.11233 g |

这五项的菜名、菜单线与完整配菜描述均与此次 Cookpit 返回逐字相同。例如 [Cookpit Piccata Milanese 详情](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/78563?client-id=ethz-wcms&lang=de)的配菜是 Truten Piccata / Tomatensugo / Safran Risotto / Broccoli，SV 商品的 `Teaser` 完全一致。以上数值属于运营商公布的配方份量和营养，不代表每位顾客餐盘的实测重量。[SV 官方菜单入口](https://sv-gastronomie.ch/menu/ETH,%20Polyterrasse,%20Z%C3%BCrich)

### 关键数据一致性限制

**取得重量之后仍不能盲目把 Cookpit 每 100 g 值乘上这个重量。** 同一 SV 商品的重量、每 100 g 营养和每份营养存在不完全一致的情况：Piccata 的 `ProteinsPer100=8.427672`、重量 600 g，相乘得到 50.566032 g，但源提供的每份蛋白质是 48.20994 g；`KCalPer100=120` 相乘得到 720 kcal，源每份为 685 kcal。这个差别超过单纯显示舍入。Rigatoni 也有较小差别。

因此后续接入应优先保存源直接提供的每份营养，记录出处，同时检验重量语义和字段一致性。当前没有足够证据解释差值来自熟制损耗、食谱版本还是运营商数据问题；不能擅自修正或把其中任一值宣布为称重结果。重量缺失为 0 的 buffet 应保留未知。

### 可复现读取路线概要

1. 从官方菜单入口确认餐厅名称及 `StoreId` / 菜单标识。
2. 读取公开前端使用的 Qnips 配置 (`FirebaseInfo`)，使用网站自身的标准访客会话流程；不使用他人的账户或绕过权限。
3. 读取该访客会话可见的公开发布菜单文档，按语言、菜单、年份和 ISO 周定位。
4. 从 `Days[].Categories[].Products[]` 读取菜名、配菜、重量、每 100 g 和每份营养；与 Cookpit 的餐厅、日期、餐次、菜单线、菜名和配菜共同匹配。

本笔记只记录公开菜单标识和数值，未保存任何认证 token、客户端 key 或会话信息。检查用解码数据保留在临时目录；此轮未修改实现。

### 公共门店目录中还有哪些 ETH SV 餐厅

已确认公开门店目录存在以下 ETH 记录；**仅确认目录与菜单 ID，不表示已逐店获取或验证重量**：

| StoreId | ETH 门店 | 午餐菜单 ID | 晚餐菜单 ID |
| --- | --- | --- | --- |
| 42005 | Dozentenfoyer | 18502 | — |
| 42006 | Mendokoro | 18503 | — |
| 42007 | Alumni Lounge | 18504 | 18657 |
| 42008 | Food market | 18505 | — |
| 42009 | Polyterrasse | 18509 | 18508 |
| 42010 | Archimedes | 18510 | — |
| 42011 | Clausiusbar | 18511 | — |
| 42012 | Polysnack | 18512 | — |
| 42013 | FoodLAB | 18513 | — |
| 42014 | Tannenbar | 18514 | — |
| 42015 | Octavo | 18515 | — |

目录来自 [SV 官方公共餐厅站](https://sv-gastronomie.ch/stores)的发布门店数据。FUSION 不在以上 ETH SV 目录记录中，仍需要核查 Compass 自己的来源。

### 追加实测：Clausiusbar 和 Food market

同一访客读取流程还实际查询了两个目录中明确列出的菜单：

| 门店 | 本周商品数 | 同时有正值重量和营养的商品数 | 2026-10-14 示例 |
| --- | --- | --- | --- |
| Clausiusbar，午餐 18511 | 20 | 20 | CRISPY SESAM CHICKEN：294 g、326 kcal / 份 |
| Food market，午餐 18505 | 39 | 34 | Herbstfrikadelle：560 g、778 kcal / 份 |

公开数据路径分别为 `/Release/de-CH/Menus/18511/Years/2026/Weeks/42` 和 `/Release/de-CH/Menus/18505/Years/2026/Weeks/42`。Clausiusbar 同日另外三项为 CRISPY SESAM PLANTED POPS（305 g）、JI WAH（404 g）、GOBI SWEET SOUR（520 g）；Food market 的 Choose 5 自选条目重量和 kcal 为 0，应保留未知。以上为主调查进程对实际发布 JSON 的直接读取，不是从通用前端功能推断覆盖。[Clausiusbar 官方菜单](https://sv-gastronomie.ch/menu/ETH,%20Clausiusbar,%20Z%C3%BCrich)、[Food market 官方菜单](https://sv-gastronomie.ch/menu/ETH,%20Food%20market,%20Z%C3%BCrich)

### FUSION：运营商公开菜单另查结果

另检查了 [Compass / Scolarest 的 FUSION 官方菜单](https://clients.scolarest.ch/eth/de/FUSION%20meal)。页面实际展示 2026-10-14 的 Poulet Geschnetzeltes Stroganoff、Ricotta-Spinat Canelloni 等，餐厅和菜单范围正确，但未找到份重展示。

页面引用的[公开脚本](https://clients.scolarest.ch/main.785cf6113d252950baf4.js)定义了 `clients.eurest.ch/api` 菜单接口；菜单模型和实际请求字段包括日期、配料、价格、过敏原、Nutriscore/Ecoscore，以及用于 calories 展示的 `MenuAdditionalInformation1`，没有发现重量字段。此次没有完成该接口菜单响应的独立原始 JSON 核查，不能将前端未引用重量字段升级为对后台不存在份重的证明。现有开源项目、Cookpit 抽查和此公开运营商页面均尚未提供可验证的 FUSION 份重。

社区关键词检索（ETH/Polymensa/FUSION + nutrition/calories/weight/Portionsgewicht）没有找到公开份重映射或已验证的 FUSION 解法；多数结果是一般份量讨论或其他地区同名餐厅，不能作为本次数据证据。对 FUSION，目前仍需运营商给出公开分享/导出或授权数据样本；前述 Eaternity 字段支持仅属于技术通道，尚不满足“已取得 ETH FUSION 具体菜品份重”的验收条件。

## 直接命中同一问题：fflopsi/mensa-zh 的 issue #38

[功能请求 #38](https://github.com/fflopsi/mensa-zh/issues/38)要求每份营养、每 100 g 营养及总重量。请求中的 545 g 示例明确来自 **UZH**，并链接 UZH FOOD2050 菜品，不能用于 Polyterrasse / FUSION。

讨论记录显示：

1. 2026-04-04 开发者最初猜测 ETH 返回值是每份。[最初讨论](https://github.com/fflopsi/mensa-zh/issues/38#issuecomment-4187403672)
2. 2026-04-05 开发者查看 ETH 官方菜单后纠正：ETH 数据是每 100 g，决定在可行时显示每份，否则标明每 100 g。[开发者更正](https://github.com/fflopsi/mensa-zh/issues/38#issuecomment-4188750817)
3. 同日请求者确认自己也查过，没有找到整份克重，所以无法自行相乘。[份重缺失讨论](https://github.com/fflopsi/mensa-zh/issues/38#issuecomment-4188757467)

检查当前源码（提交 `271afd054100f0d610415c6791af8252129f804b`，2026-09-26）：

- [ETHMensaProvider.kt](https://github.com/fflopsi/mensa-zh/blob/271afd054100f0d610415c6791af8252129f804b/app/src/main/java/ch/florianfrauenfelder/mensazh/data/providers/ETHMensaProvider.kt#L107)：读取 Cookpit `weeklyrotas`，将 ETH 营养明确标记为 `NutrientsPer.OneHundredGrams`。没有重量字段或乘以份重的步骤；能量读取 `energy-outdated`，脂肪、蛋白质等直接读取 Cookpit 字段。
- [UZHMensaProvider.kt](https://github.com/fflopsi/mensa-zh/blob/271afd054100f0d610415c6791af8252129f804b/app/src/main/java/ch/florianfrauenfelder/mensazh/data/providers/UZHMensaProvider.kt#L152)：读取 ZFV `dish.stats` 的每份值，设置 `NutrientsPer.Serving`。这是 UZH 路径。
- [Menu.kt](https://github.com/fflopsi/mensa-zh/blob/271afd054100f0d610415c6791af8252129f804b/app/src/main/java/ch/florianfrauenfelder/mensazh/domain/model/Menu.kt)：营养字段和计量基准可复用作参考，但没有整份重量模型。

实际判断：**已解决营养展示和基准区分，未解决 ETH 整份重量。** 该讨论可以直接用于避免再走一遍「把 ETH 营养误认为整份」的弯路。

## 其他已检查项目

| 项目 | 实际数据路线 / 已核对内容 | 是否取得苏黎世 ETH 份重 |
| --- | --- | --- |
| [alexandrereol/ethmensa](https://github.com/alexandrereol/ethmensa) | Apple 平台应用，当前 ETH 请求 Cookpit 周菜单，另从 glyph 取得餐厅元数据。 | 没有；当前菜品模型没有重量或营养字段，Cookpit 模型的部分营养属性仍被注释。 |
| [famoser/Mensa](https://github.com/famoser/Mensa) | Android 前身，Cookpit 周菜单；2025 年转交 fflopsi。 | 没有；ETH 菜品转换只处理描述、价格和过敏原。 |
| [samsons-rostovs/zurich-student-meals](https://github.com/samsons-rostovs/zurich-student-meals) | Cookpit 周菜单，按学生价筛选菜品。 | 没有；菜品结果包含名称、配料、价格、照片等，没有份重/营养。 |
| [pascscha/pyMensa](https://github.com/pascscha/pyMensa) | 2019 年 Python 包，旧 `webservices.ethz.ch/gastro/v1/RVRI/Q1E1/meals` 接口。 | 没有；Meal 模型只有菜单名、价格和描述。 |
| [N3XT191/mensa-menus](https://github.com/N3XT191/mensa-menus) | 2020 年脚本，使用同类旧 ETH Gastro API。 | 没有；提取菜单描述和价格，没有营养或份重计算。 |
| [Nick20500/MensaBot](https://github.com/Nick20500/MensaBot) | ETH Polyterrasse 使用 Cookpit；另一个 UZH 路径读取 FOOD2050。 | 没有；代码确实含总重量和营养相乘函数，但仅在 UZH 解析流程调用。 |
| [Gnkgo/mensa-bot](https://github.com/Gnkgo/mensa-bot) | ETH 使用 Cookpit，UZH 分开解析。 | 没有；Polyterrasse 路径只提取名称、描述、价格和过敏原；重量换算仅在 `uni.py`。 |

支撑以上判断的具体代码：

- Apple 应用：[ETHAPI.swift](https://github.com/alexandrereol/ethmensa/blob/437fd87157306a7a8d433752c92bfe4b3debf820/ethmensa/Data/API/ETH/ETHAPI.swift)、[ETHMensaAnswer.swift](https://github.com/alexandrereol/ethmensa/blob/437fd87157306a7a8d433752c92bfe4b3debf820/ethmensa/Data/API/ETH/ETHMensaAnswer.swift)、[Meal.swift](https://github.com/alexandrereol/ethmensa/blob/437fd87157306a7a8d433752c92bfe4b3debf820/ethmensa/Data/Mensa/Meal.swift)。检查版本为 2026-10-12 提交。
- Android 前身：[ETHMensaProvider2.kt](https://github.com/famoser/Mensa/blob/08e81d6cfba7448a07cb5388ee173cb4f4ae5b04/app/src/main/java/ch/famoser/mensa/services/providers/ETHMensaProvider2.kt#L176)。
- 价格聚合应用：[scrapers/eth.py](https://github.com/samsons-rostovs/zurich-student-meals/blob/f86dbe7bac0a416eb5dad14a4970c94d9e252ba5/scrapers/eth.py)。
- pyMensa：[pyMensa/Mensa.py](https://github.com/pascscha/pyMensa/blob/6b1dcf3dbc9cac1d10dee984000590dcc2b70e05/pyMensa/Mensa.py)。
- N3XT191：[menus 脚本](https://github.com/N3XT191/mensa-menus/blob/3576db2cf0af486b311dd1c62b25037869886252/menus)。
- Nick20500：[MensaBot.py 的 UZH 与 Polyterrasse 两条解析流程](https://github.com/Nick20500/MensaBot/blob/main/src/MensaBot.py#L132)。必须顺着函数调用看来源，不能因为搜到 `gesamtgewicht` 就认定 ETH 已解决。
- Gnkgo：[src/poly.py](https://github.com/Gnkgo/mensa-bot/blob/main/src/poly.py)、[src/uni.py](https://github.com/Gnkgo/mensa-bot/blob/main/src/uni.py)。

## Menzha 与旧接口线索

Menzha 作者页面明确说，ETH/SV 菜单来自 `webservices.ethz.ch`，其他机构通过菜单 HTML 解析。页面没有声称提供份重；本次没有找到其公开份重实现。[Menzha 作者说明](https://mnbucher.com/menzha/index.html)

这些项目暴露的 API 路线可以复用作菜单读取参考：旧 ETH Gastro API、glyph 的 ETH 元数据、Cookpit 周菜单，以及 UZH/ZFV GraphQL。但在以上代码和讨论中，**没有任何一条路线被证明能给出 Polyterrasse / FUSION 的熟制份重**。旧 API 在本次并未验证当前可用性；历史脚本也未实现份重字段，因此不能将换回旧 API 当成已知解决方案。

## 目前能复用什么

- 可以复用 ETH / UZH 计量基准区分、Cookpit 周菜单路径与门店映射，不需要重新研究这些部分。
- 现有开源项目中没有发现已验证的 ETH 苏黎世「Cookpit 菜品 ID → 熟制份重」映射表。此次 SV 新来源已有实际同日菜单和可验证对应关系，可以据此设计补充来源，不能仅靠名称做跨门店匹配。
- GitHub 搜索也返回本项目作者自己的 ETH/UZH 营养仓库；它们不构成他人已经独立解决 ETH 份重的证据。
- 后续有效调查必须以 **Polyterrasse / FUSION 同一道、同日、同配菜的份重实值** 为验收条件。一般系统支持 `weight`、UZH 返回份重、菜价单位写 `Portion`，都不满足这个条件。
