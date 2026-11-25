# 漓江 · 移笔游目

在一幅可漫游的青绿山水长卷中，沿岸走过象鼻山、日月双塔、阳桥和玻璃桥。

**[打开在线 Demo](https://zz69965.github.io/Lijiang_Pen_Transfer/)** · [展示分支 `jingjiang`](https://github.com/ZZ69965/Lijiang_Pen_Transfer/tree/jingjiang) · [上游项目](https://github.com/greenhandzdl/Lijiang_Pen_Transfer)

## 展示版改进

- **人物沿岸、上桥、回到岸上。** 步道贴合石岸、阳桥引道和桥面。象鼻山隔江观赏；玻璃桥一景的人物停在西侧观景台。
- **人物随位置变换比例。** 站姿参考高度沿步道平滑变化，在 2172 × 724 的原画中约为 32–46 像素。人物小于亭廊和玻璃桥，同一位置的五种姿态共用一个缩放值。
- **栏杆和岸边植物遮住人物。** 白昼、夕照和夜景各有对应的透明遮罩。走到桥上时能看到人物从栏杆后经过；桥栏缝隙仍可透出人物，原画像素保持不变。见[站位与遮挡说明](docs/GROUNDING.md)。

## 如何体验

1. 点击「入画启程」，观看或跳过象鼻山的三维序章，进入人物随行模式。也可以从「山水漫游」直达画卷，再在「更多」中选择「改为人物随行」。
2. 按住左右行走按钮，或用方向键、A/D 沿岸走。底部可选景点；拖动画卷平移，滚轮、双指或加减按钮缩放。
3. 在阳桥切换「清晨」「正午」「夕照」「入夜」，对照桥栏与人物的遮挡。清晨和正午共用白昼原画，其余时段各用一幅独立原画。

原版的分时故事、鱼市剧情、夜游器乐及无人机画稿仍可体验。三维序章和卷尾由 Three.js 实现；主画卷由 PixiJS 8、TypeScript、React 和 Vite 实现。人物行走使用关键姿态，游览路线为画卷中的艺术化安排。

## 本地运行与发布

需要 Node.js 22 或更高版本：

```bash
npm ci
npm run dev
```

本地访问 <http://localhost:5173/Lijiang_Pen_Transfer/>。使用 `npm test`、`npm run typecheck` 和 `npm run build` 验证，使用 `npm run preview` 预览构建产物。

`ZZ69965/Lijiang_Pen_Transfer` 的 `jingjiang` 分支用于展示。推送到该分支后，GitHub Actions 构建并发布到上面的 GitHub Pages 地址；`main` 保留为上游同步分支。Pages 的发布源设为 **GitHub Actions**。详见[发布与验收](docs/QUALITY.md)。

## 来源与授权

本展示版基于 [`greenhandzdl/Lijiang_Pen_Transfer`](https://github.com/greenhandzdl/Lijiang_Pen_Transfer)。程序及明确标示的文档沿用原仓库的 [MIT License](LICENSE)；美术、音乐和其他素材的使用范围见[素材版权声明](ASSETS-LICENSE.md)。`qingming-riverside` 仅作体验参考，未使用其源码或美术素材。
