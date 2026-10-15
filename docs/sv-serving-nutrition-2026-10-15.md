# SV 整份营养接入

实现日期：2026-10-15，Europe/Zurich。

`menu.py` 继续以 Cookpit 的门店、菜品和餐次为主；`sv_menu.py` 通过
[SV 官方公共菜单](https://sv-gastronomie.ch/stores)自身使用的访客流程读取
公开 Release 菜单。无需配置个人账号或密钥，访客凭据只保存在内存。

## 计算规则

- 优先保留运营商直接提供的每份值，包括真实零值。
- 缺少的营养字段，仅在有正值份重时按 `每100g数值 × 份重g / 100` 补算。
  换算在显示舍入前进行。UZH FOOD2050 的全部门店也复用这条规则。
- SV 的 0g 不作为实际份重；0g 配合全零营养的自助餐占位记录保持未知。
- 匹配必须限定门店、日期、餐次、菜单线、菜名和配菜。允许配菜顺序变化、
  Cookpit 明确标记的长描述截断，以及 Tannenbar 已核对的菜单线别名。
  有多个候选时不补值，不进行相似菜名猜测。
- `nutritionSource` 保存官方入口、日期、门店/菜单/商品 ID、匹配方式，
  以及源直接提供和补算的字段列表。

映射覆盖 Clausiusbar、Dozentenfoyer、FoodLAB、Archimedes、Polyterrasse、
Polysnack、Tannenbar、Alumni Lounge、Mendokoro、Food market、Octavo；
包含 Polyterrasse 和 Alumni Lounge 的晚餐菜单。

## 实测与验证

最新当天真实预览：32 家食堂，ETH 74 道菜，其中 44 道有正值整份 kcal；
UZH 21 道菜全部有正值整份 kcal。ETH 的整份数据分布在 10 家当日供餐食堂。
这是当时数据的覆盖统计，不是每日固定验收数量。

同一轮抓取中，Cookpit 将 Clausiusbar 的 Crispy Sesam Chicken 改成了
Crispy Sesam Beef，SV 尚未同步，匹配因此跳过该条。
FUSION/Compass、Rice Up!、Basel 等未匹配到 SV 实际份重的菜品继续保留未知。

Python 回归、日期/设置检查、动画合约及 Chromium 浏览器回归通过。
浏览器核对了历史 Polyterrasse Piccata 样本：600 g、685 kcal，保留源值，
不会用 120 kcal/100g 强制改写成 720 kcal；并覆盖日期切换、照片节点复用、
快速操作和 reduced motion。

完整 15 日在线构建在 2026-10-19 的 UZH Mensa Oerlikon / Tierspital
详情页遇到既有 `menuItem field is missing` 错误，被发布校验阻止。
原 `output/` 未被替换。当日真实预览单独生成在
`/private/tmp/eth-uzh-sv-preview`；没有绕过完整构建的错误保护。

## 同日上线修复：未来菜单链接

后续定位到上述失败由程序沿用本周分类、拼接下周详情链接触发。
Food2050 官方导航支持 `?week=43&year=2026`：10 月 19 日 Oerlikon
实际只列出 Garden 和 Farm，没有 Butcher；Tierspital 的对应周为明确的
带日期空列表。原先请求的 Butcher 页面不在当天发布的菜单中。

抓取现按日期对应的 ISO 周读取官方列表，仅请求列表提供的详情链接，
按食堂/ISO 年/周缓存。新增真实周视图样本覆盖分类变化、日期空列表、
跨年 ISO 周和缓存。源站实际列出的详情若仍不可解析，发布保护照常拦截。
两家食堂的原始日期场景已在线复测通过；没有把错误页面解释为闭店。

修复后的完整在线构建通过：2026-10-15 至 2026-10-29，共 15 个日期、
每日期 32 家食堂、843 道菜；当天 ETH 74 道、UZH 21 道。
71 项 Python 回归、日期/设置检查、动画合约及 Chromium 回归通过。
这些数量是本次抓取结果，不是固定发布阈值。
