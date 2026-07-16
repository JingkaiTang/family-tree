# 虚构家族头像图集生成说明

- 生成方式：Codex 内置图像生成工具
- 用途：`synthetic-family-200-6.family` 的测试头像源图
- 产物：`synthetic-avatar-atlas.png`
- 切片规则：8 列 × 6 行，每格一人，按行对应第 1～6 代

## 生成提示词

```text
Use case: stylized-concept
Asset type: source atlas for a desktop family-tree application's synthetic test avatars
Primary request: Create one exact contact sheet containing 48 distinct fictional head-and-shoulders portrait avatars.
Subject: fictional Chinese and East Asian family members, varied facial features, hairstyles, glasses, clothing, and gender presentation; no real or recognizable people.
Style/medium: polished semi-realistic digital illustration, clearly illustrated rather than photographic, cohesive style across all portraits.
Composition/framing: EXACTLY 8 columns and EXACTLY 6 rows, 48 equal rectangular cells, one centered person per cell, consistent head-and-shoulders crop, face fully visible. The grid fills the entire canvas edge to edge with no outer margin, no gutters, no labels, and no merged or missing cells.
Age rows: row 1 age 80-95; row 2 age 65-80; row 3 age 50-65; row 4 age 35-50; row 5 age 20-35; row 6 children and teenagers age 8-16. Every portrait within a row must visibly fit that age band.
Scene/backdrop: each cell has a simple low-detail muted pastel background; neighboring cells use distinguishable background colors.
Lighting/mood: soft even studio-like illustration lighting, friendly neutral expressions.
Color palette: warm natural skin tones, muted teal, slate, sand, rose, olive, and pale blue backgrounds.
Constraints: exactly 48 people; exactly one person in every cell; exact 8 by 6 alignment; consistent scale and crop; all subjects fictional; no celebrity resemblance.
Avoid: text, numbers, labels, logos, watermark, borders, frames, decorative objects, group portraits, repeated faces, cropped heads, hands covering faces, photorealism, shadows crossing between cells.
```
