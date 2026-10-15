# iOS/macOS 动画数值审查（研究依据）

日期：2026-08-21。范围：`template/style.css` 与 `template/app.js` 中所有可见的 CSS/WAAPI 动画；本文件是研究与审查记录，不改应用代码。

## 结论

网站在实现上**一致且克制**：所有有时长的视觉动画都共用
`cubic-bezier(.32, .72, 0, 1)`，时长为 150/200/250/300/350 ms，且有首次渲染静默、快速操作收敛和 `prefers-reduced-motion` 处理。这符合 Apple HIG 所说的「有目的、简短精确、可取消、可选择」的方向。[Apple HIG: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

但若「符合 Apple iOS/macOS best practice」意为**严格采用 Apple 公开的系统默认数值**，结论是**不符合**：当前曲线不是 Apple 公开命名的默认曲线，不能称为 “Apple standard ease”。它是成熟前端社区常用的 **iOS sheet/modal 近似值**；适合空间移动（抽屉、sheet、内容展开），没有证据表明它应当统治所有微交互、颜色和 hover。

## 当前数值清单

| 类别 | 当前数值 | 使用处（概括） | 审查 |
| --- | --- | --- | --- |
| 统一曲线 | `cubic-bezier(.32,.72,0,1)` | `--ease` 与 `ANIM_EASE` | 一致；是强 ease-out，不是 Apple 公开的 universal/default 曲线。 |
| 150 ms | 轻量颜色、边框、hover | mensa 行、复制按钮等 | 合理。前端实践中，按压反馈常见 160 ms、ease-out。[Kowalski](https://emilkowal.ski/ui/building-a-hold-to-delete-component) |
| 200 ms | trigger、日历按钮、chip state layer | 局部反馈 | 合理；一般 UI ease-in/out 的推荐区间为 200–500 ms。[web.dev](https://web.dev/articles/choosing-the-right-easing) |
| 250 ms | 勾选圆点、group chip | 选择状态 | 合理；仍处在同一通用区间。 |
| 300 ms | 分段控制、抽屉/汉堡/内容同步移动、主题色 | 中距离移动与色彩变化 | 合理且协调。抽屉若追求 *sheet* 的严格复刻则偏快（见下文 500 ms 对照），但对网页 navigation drawer 是合理取舍。 |
| 350 ms | 日历、mensa/raw disclosure、照片高度、FLIP、内容高度 glide | 大面积/布局变化 | 有直接 Apple 时长锚点：SwiftUI `.easeInOut` 的默认时长就是 0.35 s；也位于 web.dev 的 200–500 ms 区间。[Apple](https://developer.apple.com/documentation/swiftui/animation/easeinout) [web.dev](https://web.dev/articles/choosing-the-right-easing) |
| 320 / 500 ms | scroll-lock 延后与 `transitionend` fallback | 非可见动画 | 正确地略大于 300/350 ms；不应当视为视觉节奏。 |
| 0 ms linear | drawer `visibility` 的离散切换 | 打开/关闭可访问性状态 | 合理；没有伪造可见运动。 |

## 曲线的数值含义

CSS cubic-bezier 的两个控制点依次是 `(x1,y1)`、`(x2,y2)`。下表是同一绝对时间进度所达到的属性进度（数值解，四舍五入至三位）：

| 时间进度 | 本站 `.32,.72,0,1` | Apple CA `default` `.25,.1,.25,1` | UIKit `easeInEaseOut` `.42,0,.58,1` |
| --- | ---: | ---: | ---: |
| 10% | 0.270 | 0.095 | 0.020 |
| 50% | 0.955 | 0.802 | 0.500 |
| 90% | 0.999 | 0.994 | 0.980 |

所以本站曲线会在时长一半时完成约 95.5% 的位移，留下较长、柔和的 settle；它给人的感觉是「立刻响应、慢慢停下」。这对抽屉和内容高度很好，但同样的前半段放在 150 ms 的细小颜色/边框变化上，会在约 75 ms 内几乎完成，实际可见节奏会比标称时长快得多。

## Apple 官方基线

Apple 没有发布一份对 Web CSS 规定「唯一 iOS/macOS 曲线 + 唯一时长」的 HIG。当前 HIG 提供的是目的性、简短性、可选和可取消等原则，而不是一张毫秒表。[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

不过 Apple 的动画 API 发布了下列**精确**数值，因而是比「Apple standard」说法更可靠的对照：

| Apple API/场景 | 公开数值 | 与本站的关系 |
| --- | --- | --- |
| Core Animation `default` | `(.25,.1),(.25,1)`，即 `cubic-bezier(.25,.1,.25,1)`；Apple 明确说使用它可匹配「大多数系统动画」。[文档](https://developer.apple.com/documentation/quartzcore/camediatimingfunctionname/default) | 当前曲线不同，且比它前半段快得多。若目标是公开的 CA 默认值，这是首选的单一 CSS 基线。 |
| Core Animation / UIKit `easeInEaseOut` | `(.42,0),(.58,1)`，即 CSS `ease-in-out`；`UIView.animate(withDuration:animations:)` 使用 `curveEaseInOut`。[曲线](https://developer.apple.com/documentation/quartzcore/camediatimingfunctionname/easeineaseout) [UIKit](https://developer.apple.com/documentation/uikit/uiview/animate%28withduration%3Aanimations%3A%29) | 当前曲线不是这个 UIKit 基本动画曲线；当前会更强烈地 ease-out。 |
| Core Animation 未指定时长 | 0.25 s（仅限 CA 默认/事务情形，**不是**所有 UI 的通用规定）。[文档](https://developer.apple.com/documentation/quartzcore/calayer/add%28_%3Aforkey%3A%29) | 本站的 250 ms 选择状态与此相符；300–350 ms 是刻意更从容的布局节奏。 |
| SwiftUI `.easeInOut` | 默认 0.35 s。[文档](https://developer.apple.com/documentation/swiftui/animation/easeinout) | 本站 350 ms 布局动画有直接、公开的 Apple 时长对应；曲线本身仍不同。 |
| SwiftUI `.default`（iOS 17/macOS 14 起） | `spring(response: 0.55, dampingFraction: 1.0, blendDuration: 0.0)`；此前才是 `easeInOut`。[文档](https://developer.apple.com/documentation/swiftui/animation/default) | 现代原生默认甚至不是一条 bezier；单一 CSS bezier 不可能严格复刻所有现代 Apple motion。 |

## 前端社区的 iOS 近似值

当前数值不是凭空选择。Ionic 的维护中 iOS modal enter 源码明确使用
`cubic-bezier(0.32,0.72,0,1)` 与 `500 ms`；其 iOS navigation transition 也用同曲线（540 ms）。[Ionic modal 源码](https://github.com/ionic-team/ionic-framework/blob/main/core/src/components/modal/animations/ios.enter.ts) [Ionic navigation 源码](https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/transition/ios.transition.ts)

Emil Kowalski 的开源 Vaul drawer 文章同样将该曲线与 500 ms 说明为接近 iOS Sheet 的前端实现，并注明曲线来源于 Ionic。[文章](https://emilkowal.ski/ui/building-a-drawer-component) 这支持将本站的曲线称为「**Ionic/Vaul 的 iOS-sheet-like 曲线**」，但它是社区经验，不是 Apple 官方规范。

在一般 Web UI 的数值上，web.dev 建议 ease-in/ease-out 为 200–500 ms，并建议避免无目的的弹性/反弹；本站 200–350 ms 全在该范围内，150 ms 也与社区的快速按压反馈实例相符。[web.dev](https://web.dev/articles/choosing-the-right-easing) [Kowalski](https://emilkowal.ski/ui/building-a-hold-to-delete-component) Vercel 的前端指南补充：easing 应按距离、尺寸、触发方式选择，动画应当可中断且尊重 reduced motion。[Vercel Guidelines](https://vercel.com/design/guidelines)

## 可执行的判定

1. **数值健康度：通过。** 150–350 ms 的层级清晰；抽屉三件套同为 300 ms、内容/展开同为 350 ms，避免了不同元素错拍。现有快速切换收敛及 reduced-motion 处理亦符合 Apple HIG 的方向。
2. **Apple 官方默认值一致性：不通过（仅限措辞与严格匹配）。** 将 `.32,.72,0,1` 写作 “Apple's standard easing” 不准确；公开的 CA `default` 是 `.25,.1,.25,1`，UIKit 基本动画是 `.42,0,.58,1`，现代 SwiftUI 默认是临界阻尼 spring。
3. **iOS 风格社区一致性：通过，但限于空间转场。** 当前曲线精确匹配 Ionic/Vaul 的 iOS sheet/modal 代理。本站 300 ms 抽屉比该代理的 500–540 ms 快 40–44%，但仍处于通用 Web UI 的合理范围；它不是缺陷，除非产品目标是逐帧拟合 iOS Sheet。
4. **不应从此报告自动改代码。** 仓库的动画 contract 规定一个统一曲线，并把当前数值列为产品决定。若产品所有者希望「严格 Apple API 默认」而非「Apple-like sheet 感」，应先明确选择：
   - 保留 `.32,.72,0,1`，并把文案改为 *Ionic/Vaul iOS-sheet-like*；或
   - 改为公开 CA `default` `cubic-bezier(.25,.1,.25,1)`（最严格的单曲线官方基线）；或
   - 按语义分层/用 spring（最贴近现代原生行为，但会改变现有单曲线 contract）。

建议在真实 iPhone Safari 与 macOS Safari 上用 1x 速度对照测试：打开/关闭抽屉、连续切换 Lunch/Dinner、展开日历与照片。重点观察 300 ms 抽屉的末段是否显得急促，以及 150 ms 控件反馈是否肉眼变成瞬时；动画 best practice 不能只由静态毫秒数替代实际帧率与手感验证。
