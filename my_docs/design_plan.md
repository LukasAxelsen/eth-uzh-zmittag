agent必须遵守的最终开发约束。

本产品名称为zmittag，面向ETH和UZH的大学生，目的是帮助他们选择合适的食堂和餐点。

与其他聚合系统不一样的是，这个聚合系统还显示营养。

# 总模块

1. 信息收集：从官方的api把苏黎世全部提供学生优惠的大学食堂的数据都获取出来，尽可能获取营养数据
2. 内容展示：这是web的前端部分，负责用我规定的样式展示所有信息
3. 用户登录：提供登录功能，让用户可以直接用google账号登录本网站，并且保存个人数据
4. 健康计算：根据用户提供的个人数据来计算最合适的每餐营养，这个模块主要就是提供透明的计算方式。最后把算出来的数据传给内容展示

# 信息收集

## 食堂

ETH

| 项目内分组 | 网点 |
|---|---|
| Central（14） | bQm、CafeBar、Clausiusbar、Kiosk CLA、Dozentenfoyer、Einstein & Zweistein、food&lab、Archimedes、Mensa Polyterrasse、Polysnack、Tannenbar、Eureka Take Away、Zwei Grad Bistro、Alumni quattro Lounge |
| Hoengg（4） | Bellavista、Mendokoro、FUSION meal、Rice Up! |
| Irchel（3） | food market、Science Lounge、Flavour Kitchen |
| Oerlikon（1） | Octavo |

UZH

| 项目内分组 | 网点 |
|---|---|
| Central（3） | Untere Mensa、Obere Mensa、Lichthof |
| Irchel（3） | Mensa Irchel、Green Kitchen Lab、Seerose |
| Oerlikon（1） | Mensa Oerlikon（Binzmühle） |
| Other（3） | Cityport Mensa、Tierspital Mensa、Botanischer Garten |

## 餐点

每个餐点主要有【标题】、【价格】和【营养】三块。

提供的营养字段：

| 指标 | JSON 字段 | 单位 | ETH | UZH |
|---|---|---|---|---|
| 能量／热量 | `kcal` | kcal | 支持 | 支持 |
| 蛋白质 | `protein` | g | 支持 | 支持 |
| 总脂肪 | `fat` | g | 支持 | 支持 |
| 饱和脂肪 | `saturated` | g | 支持 | 支持 |
| 碳水化合物 | `carbs` | g | 支持 | 支持 |
| 糖 | `sugar` | g | 支持 | 支持 |
| 盐 | `salt` | g | 支持 | 支持 |
| 膳食纤维 | `fiber` | g | 未采集 | 支持 |
| 每份重量（非营养素） | `weight` | g | 未采集 | 支持 |

ETH：仅采集每 100 g 的营养值
UZH：支持每 100 g 和每份总量

# 用户登陆

网站可以使用google登录。

存储以下个人用户数据：
* 健康数据（在健康计算处定义）
* 上次选定的食堂和用户自定义的标签组

# 健康计算

用户需要提供一些具体个人信息，以便计算模块算出合理的所需营养。
