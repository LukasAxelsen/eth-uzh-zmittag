# ETH 菜单整份重量来源调查

调查日期：2026-10-14（Europe/Zurich）。仅查询官方公开页面、接口和文档；未联系运营商，未修改抓取或前端实现。

## 结论

**有办法，而且同日后续调查已确认苏黎世 Polyterrasse 的 SV 新公共菜单提供实际份重和整份营养。** 详见 [苏黎世专门调查](eth-zurich-serving-weight-existing-solutions-2026-10-14.md)；该来源的重量与部分每份营养存在不一致，接入时不能盲目相乘。以下记录此前的 ETH Basel、Cookpit 与运营商系统调查。Cookpit 本身仍没有提供重量，Polyterrasse 的补充来源不自动覆盖 Compass / FUSION。

## 已确认可用：ETH Basel Flavour Kitchen 的 FOOD2050 详情页

[Flavour Kitchen 官方 Basel 门店页](https://www.flavourkitchen.ch/standorte/basel)明确标识餐厅位于 ETHZ、Klingelbergstrasse 48，并嵌入 FOOD2050 菜单。因此这不是另一个同名餐厅的菜单。

2026-10-14 实际匿名 HTTP 查询取得以下菜品：

| 字段 | 实测返回值 |
| --- | --- |
| 菜名 | QUORNGESCHNETZELTES |
| 配菜 | Safransauce, Pilaw Reis, Lauch, Ofenranden |
| `dish.stats.servingWeight` | `{"amount":480,"unit":"g"}` |
| `dish.stats.energy.amount` | 582.00474 kcal / 整份 |
| `dish.stats.energy.amountPer100g` | 121.25098749999998 kcal / 100 g |
| `dish.stats.protein.amount` | 22.11833 g / 整份 |
| `dish.stats.protein.amountPer100g` | 4.607985416666667 g / 100 g |

来源：[当天 Plants & More 菜品详情](https://app.food2050.ch/de/zfv/flavour-kitchen/flavour-kitchen-basel/mittagsverpflegung%2Cplants-and-more/2026-10-14)。公开页面也直接显示 Gesamtgewicht 480 g、整份 582 kcal、蛋白质 22.12 g。这里已经提供整份营养素，无需用经过显示舍入的每 100 g 数值反算。

该页面当前使用 Next.js App Router，数据在 HTML 的 `self.__next_f.push` 内容里；此次页面没有 `__NEXT_DATA__`。主调查进程用项目现有 `_food2050_menu_item` 对这个实测 HTML 进行了读取，已成功取得菜名、480 g、整份 kcal 和蛋白质，说明这个样本无需修改通用解析器。未来接入仍需要匹配同一门店、日期、菜单线和配菜，不能将同名菜的营养值混用。这里只确认了这个公开菜品；没有承诺所有日期、所有菜品均有完整字段。

主调查进程还核对了同日 Cookpit Flavour Kitchen 条目 [76963](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/76963?client-id=ethz-wcms&lang=de)：名称为 QUORNGESCHNETZELTES & PILAWREIS，描述含 Quorn Geschnetzeltes / Safransauce / Pilaw Reis mit Gemüse / Ofenranden，与 FOOD2050 示例语义相符。这说明额外来源确有补全潜力，但尚未实现或验证自动关联规则。

覆盖范围需要区分：ETH 官方说明 Basel 的 Flavour Kitchen / Science Lounge 自 2024 年采用 ZFV + FOOD2050；苏黎世 SV 餐厅在 2026 年推出的是 Beelong ECO-SCORE。[ETH 官方说明](https://ethz.ch/en/the-eth-zurich/sustainability/netto-null/programm-eth-netto-null/sustainable-gastronomy.html)

## 运营商系统线索（SV 公共菜单突破详见后续调查）

### Compass / FUSION：可申请 Eaternity 配方数据

Compass 官方确认与 Eaternity 合作。[Compass 营养与可持续菜单介绍](https://welcome.compass-group.ch/unsere-verantwortung/ernaehrung/)

Eaternity 官方 Recipe API 文档确实有以下字段：

- `final-weight-per-portion`：每份烹调完成后的重量，单位 g。
- `nutrient-values-estimated-per-recipe-portion`：配方计算得到的每份营养值，可通过 `nutrient-values=true` 请求。
- 输入 `weight` 可以明确指定每份最终重量；未提供时使用原料重量汇总的默认逻辑，因此必须确认实际录入了熟重，而非把默认值当作称重结果。

访问需要 API key（Basic Auth）以及对应的厨房、配方标识。[Eaternity 官方 Recipe API](https://eaternity.org/documentation/de/api/recipes/)

**这证明技术上存在份重字段，不证明 ETH FUSION 的每道菜都已填写，也不是匿名可抓取接口。** 实际可行的下一步是询问 Compass 是否能导出 FUSION 每日菜单的熟制份重和整份营养，或提供授权数据接口；应优先索取导出，避免要求披露完整商业配方。

### SV：可申请菜单份重导出或 Beelong 分享链接

Beelong 官方更新说明列有菜单中调整各配方克重、调整菜单总量、导出已供应菜单的功能。FAQ 还说明可以分享菜单及详细结果。[Beelong 功能说明](https://beelong.ch/en/les-nouveautes-du-calculateur-beelong/)、[Beelong FAQ](https://beelong.ch/faqcalc/)

结合 ETH 的 SV / Beelong 推出说明，这是值得询问的数据通道。但本次没有找到 ETH SV 餐厅的公开 Beelong 菜单分享链接，也没有证明分享页面会提供熟制总重量。不能仅凭 ECO-SCORE 标识反推出重量。

### Bellavista

本次未找到 Bellavista 的公开 FOOD2050 菜品份重；其餐厅官网直接请求返回 403，不能据此断言后台没有相关数据。ETH 官方页面提供菜单入口和联系电话 +41 44 633 01 91；ZFV 官方列出 `info@bellavista-ethz.ch`。[ETH Bellavista 页面](https://ethz.ch/en/campus/erleben/gastronomie-und-einkaufen/gastronomie/restaurants-und-cafeterias/hoenggerberg/bellavista.html)、[ZFV Bellavista 页面](https://www.zfv.ch/fr/planifier-un-evenement/restaurant-bellavista)

## Cookpit 与 ETH 官方菜单页面的直接核对

以下由主调查进程在 2026-10-14 直接读取公开 HTTP 返回并核对字段：

- [Cookpit 当日 meals 查询](https://idapps.ethz.ch/cookpit-pub-services/v1/meals?client-id=ethz-wcms&lang=de&date=2026-10-14&facility-id=9&meal-times-after=2026-10-14T00%3A00%3A00Z&meal-times-before=2026-10-14T23%3A59%3A59Z)：74 条记录；递归字段名中没有重量/份重字段。价格单位 `Portion` 和 `100 g` 不是实际份重。
- [ETH 官方当日 Polyterrasse 菜单](https://ethz.ch/de/campus/erleben/gastronomie-und-einkaufen/gastronomie/menueplaene/offerDay.html?date=2026-10-14&id=9)加载的[菜单脚本](https://ethz.ch/de/campus/erleben/gastronomie-und-einkaufen/gastronomie/menueplaene/offerDay/_jcr_content/par/scriptnode/index.js)使用 `weeklyrotas`、`meals/{lineId}` 和 `facilities`，营养标签明确为 `pro100g`；未发现份重渲染。
- [Polyterrasse 周菜单查询](https://idapps.ethz.ch/cookpit-pub-services/v1/weeklyrotas?client-id=ethz-wcms&lang=de&rs-first=0&rs-size=50&valid-after=2026-10-12&valid-before=2026-10-19&facility=9)也没有重量字段。
- [菜品详情 78596](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/78596?client-id=ethz-wcms&lang=de)没有重量；多出的 `energy-outdated` 是 kcal 字段，不能据此认定为整份热量或反推出重量。
- 另核对 [Polyterrasse Piccata Milanese / 78563](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/78563?client-id=ethz-wcms&lang=de)、[FUSION Poulet Geschnetzeltes Stroganoff / 78636](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/78636?client-id=ethz-wcms&lang=de)、[Flavour Kitchen PASTA ALFREDEO / 76962](https://idapps.ethz.ch/cookpit-pub-services/v1/meals/76962?client-id=ethz-wcms&lang=de)，均无份重；后两个 Cookpit 样本连营养数据也没有，因此单补重量仍不够。

这些是检查范围内的结论，不是对所有未公开端点的存在性证明。

## 可执行的后续步骤

1. 对 ETH Basel，接入已确认的 FOOD2050 详情数据；首先核对它与项目中 ETH 门店记录的对应关系。
2. 对苏黎世 SV / Compass，请运营商提供日期、餐厅、菜单线、菜名、熟制整份重量 g、整份 kcal/营养素，以及是否包含酱汁、配菜、沙拉等范围。若只给重量，必须确认它与当前每 100 g 营养值的配方范围一致。
3. 可以从 [Polyterrasse 官方联系人](https://ethz.ch/de/campus/erleben/gastronomie-und-einkaufen/gastronomie/restaurants-und-cafeterias/zentrum/mensa-polyterrasse.html)（Markus Romano，+41 44 632 62 01）、[FUSION 联系人](https://ethz.ch/de/campus/erleben/gastronomie-und-einkaufen/gastronomie/restaurants-und-cafeterias/hoenggerberg/fusion-meal.html)（+41 44 633 70 67）或 [ETH Gastronomiekommission](https://ethz.ch/de/campus/erleben/gastronomie-und-einkaufen/gastronomie/gastronomiekommission.html)的协调团队开始；本次未发送任何联系信息。
4. 如果用途是个人实际吃下的一餐，称食物净重是直接可得的另一条路；公式为 `整份营养素 = 每 100 g 数值 × 净重 g / 100`。这仍是基于公布配方密度的估计，实际配菜比例、续加和剩餐会影响结果。不要用照片、价格或泛用的「标准一餐 500 g」填充官方总量。
