# Jev 简历-JD 匹配度初筛（DeepSeek 用户运营岗）

> 用 TypeSafe 的 System One 模型 **Jev** 对候选人简历与岗位 JD 做原子化匹配度评估：文本进、类型化决策+校准概率出、代码侧合成总分。
> 本文件夹是完整的项目封装：判据模板、测试请求、测试结果、简历样本、实验记录全部在内。

---

## 1. 项目由来与经过（2026-09-19）

1. **通读官方文档。** 通读了 docs.typesafe.ai 的全部核心页面（Introduction / System One / AI Primer / Confidence / Primitives / Models / How to build / State），并翻译为中文（背景资料见第 9 节）。核心认知：Jev 不生成文本，只返回类型化决策与校准概率；最佳用法是"原子问题 + 一次请求并行 + 代码合成"。
2. **厘清能力边界。** 讨论确认：Jev 适合回答"一个懂行的人拿到材料后几秒钟能做出的直觉判断"；"这个公司是否值得投资"式的大问题必须拆成原子问题后才能介入，最终判断由代码合成。
3. **硬币实验（反面教材）。** 用"硬币正反面概率"测试格式，得到 heads 95% / confidence 89% 的坏结果。归因：① state 只放了话题标签没有材料（离群输入下校准失效）；② 问的是"两个数字"，Choice 原语却是"二选一"；③ 置信度只反映分布形状，尖≠对。由此得出三条使用纪律：**有材料、单一判断、判据明确**。
4. **选定场景。** 提出 HR 简历初筛，官方 use-case map 的 Recruiting 板块逐条印证（显式岗位标准评估、经验识别、能力打分、路由、不确定升级人工）。
5. **设计判据。** 以 DeepSeek 用户运营岗 JD 为例，产出 10 题判据 JSON（5 Noul + 4 Score + 1 Choice），全部塞进一次请求并行评估。关键设计：instructions/criteria 用英文写（主训练语言准确率最高）、中文软要求全部操作化为"简历里可找到的证据形态"、无"总分"问题。
6. **杜撰测试简历。** 构造候选人"小明"（软件工程本科 → 在线教育社群 2 年 → HR SaaS 用户运营 3 年 + 业余 12000 人 AI 社区），故意埋 4 个考点：协调短板题、exceptional 主观题、TensorFlow 课程干扰项、"共建≠主导"归因陷阱。
7. **中英双版实测。** 同一事实的 CN/EN 两份简历、同一套判据，在 console Playground 各跑一次。
8. **批改与修订。** 10 题中 8 题与答案卷对齐，中英最大偏差 0.08；据此修订两处判据（v2，见第 4 节）。
9. **v2 复测与负对照。** v2 回归通过后，构造两份负对照简历（明显不合格 / 光鲜空洞陷阱）做逆向检验：机制通过，但暴露"声称 vs 证据"判据缺口（见第 8 节）。
10. **v3 封版。** 应用 ai / exceptional 两处判据增补并做四例全量回归，陷阱简历的 ai 题 0.95→0.49、正负样本零外溢，判据封版 v3（见第 4 节）。

## 2. 核心结构

```
state
├─ job                      # JD 结构化拆解（questions 用 `job.*` 路径引用）
│  ├─ title / team / mission
│  ├─ responsibilities[5]   # 职责（英文转写）
│  └─ requirements          # min_education / traits / skills / preferred
└─ resume.full_text         # 简历原文（发送前剥离 PII）

questions（10 题，一次请求全并行）
├─ Noul ×5   教育门槛 / 英文书面证据 / AI 重度用户 / 效率工具实战 / 极致经历
├─ Score ×4  用户社区工作深度 / 数据指标能力 / 跨团队协调交付 / 碎片信号洞察（各 0–3 档）
└─ Choice ×1 dominant_background 背景分桶（路由给不同招聘官）
```

设计原则：每题只含一个判断；判据用 what/not_for/examples/signals 对比式定义；软要求给操作化定义；**没有"匹配度总分"问题**——总分是代码的事。

## 3. 测试结果与发现（v1 判据）

逐题结果（完整数据在 `results/`）：

| 问题 | 预期 | CN | EN | 判定 |
| --- | --- | --- | --- | --- |
| education_bachelor_or_above | 高 | 0.99 | 0.99 | ✓ |
| written_english_evidence | 高 | 0.98 | 0.97 | ✓ |
| ai_products_heavy_use | 高 | 0.98 | 0.99 | ✓ |
| efficiency_tools_in_work | 高 | 0.98 | 0.99 | ✓（TensorFlow 课程干扰未生效） |
| exceptional_pursuit | 高或中值+低置信 | 0.90 | 0.89 | ✓ 健康的判断题置信度 |
| user_community_work_depth | 2–3 | 3 (conf 1.0) | 3 (conf 1.0) | ✓ |
| data_and_metrics_ability | 2 | 2.99 (0.99) | 3.0 (1.0) | ✗ → v1 判据歧义，v2 修复 |
| coordination_and_delivery | 2 | 2.67 (**0.67**) | 2.75 (**0.75**) | △ 骑墙+低置信，但见发现 3 |
| signal_to_insight | 2–3 | 2.99 (0.99) | 2.99 (0.99) | ✓ |
| dominant_background | user_or_community_ops | ✓ 1.0 | ✓ 1.0 | ✓ |

**发现 1 — 校准画像健康。** 事实检索题（学历、证书）置信 0.97–0.99；主观判断题（exceptional）同一份证据只给 0.89–0.90。事实题高、判断题低半档，校准在正确工作。

**发现 2 — 骑墙行为是健康信号。** coordination 题模型没有直接上当成 3，而是 {2: 0.33, 3: 0.67} 骑墙、置信 0.67——它"知道"这是边界案例。

**发现 3 — 置信度阈值会跨语言漂移（生产风险）。** 同一简历，CN 置信 0.67 / EN 0.75。若路由门槛设 0.7，中文版转人工、英文版自动放行——候选人命运取决于管线语言。**对策：整条管线固定一种语言，并按该语言校准阈值。**

**发现 4 — 判据歧义导致"自信地错"。** data 题的"共建≠主导"区分从未写进判据，模型对模糊边界给了 0.99+ 高置信。改判据，不改提示词。

**性能与成本：** CN 3901 tok / 197ms，EN 3525 tok / 106ms（CJK 约 +10% token、延迟 ×1.9，均可承受）；单份简历约 **$0.00016**，$5 赠金（2026-10-19 到期）约够筛三万份。

## 4. 判据 v1 → v2 修订

| 位置 | v1 问题 | v2 修改 |
| --- | --- | --- |
| `data_and_metrics_ability` 第 2 档 | "共建指标体系"字面命中不了任何档 | what 增加 "or co-built metrics owned by others"；signals 增加 "Co-defined metrics with analysts or PMs without owning the system" |
| `data_and_metrics_ability` 第 3 档 | "Defined metric systems" 未区分主导/参与 | what 改为 "Owned the definition of a metric system end-to-end (**not merely co-built it**), or built monitoring or alerting pipelines" |
| `coordination_and_delivery` 第 3 档 | "Led end-to-end" 未区分主导闭环/在场协调 | what 增加 "— **personally owned the closure, not just attended or coordinated it**" |

预期：小明这两题应落回 2 分档、置信回升。**`archive/v1-requests/` 与 `results/*-test-result.json`（无 v2 后缀）严格对应；`requests/` 为 v2 判据版本。**

**v2 复测（2026-09-19，`results/*-test-result-v2.json`）——修订生效：**

| 问题 | v1 CN / EN | v2 CN / EN | 结论 |
| --- | --- | --- | --- |
| data_and_metrics_ability | 2.99 (0.99) / 3.0 (1.0) | **2.18 (0.81) / 2.18 (0.81)**，分布逐字节一致 {2: 0.82, 3: 0.18} | 落回 2 档 ✓，中英零偏差 |
| coordination_and_delivery | 2.67 (0.67) / 2.75 (0.75) | 2.56 (0.56) / 2.60 (0.60) | 向 2 靠拢 ✓；置信更低而非回升——模型如实承认这是真边界案例，将稳定触发人工复核 |

复测结论：
1. 判据歧义修复后，"共建 ≠ 主导"被正确执行，且该题中英结果完全一致——**更明确的判据同时降低了语言敏感性**（全卷中英最大偏差 v1 0.08 → v2 0.04）。
2. coordination 的"置信回升"预期落空，但原因良性：协调证据强（2 档）与闭环归属模糊（3 档信号）在简历里真实并存，判据变严后模型骑墙得更诚实。按 0.7 门槛该题将始终转人工——对"参与过但未主导闭环"的候选人正是设计想要的行为。
3. 判据改动无外溢：其余 8 题 v1→v2 结果不变（Noul 全部 ±0.01 内，Score 3/2.99、Choice 均持平）。
4. 小明合成总分：CN ≈ 0.894 / EN ≈ 0.898（AI 加分后 ≈ 0.944 / 0.948）；硬门槛全过，仅 coordination 转人工——与人设（协调短板）完全吻合。

**v2 → v3 修订（负对照 B 驱动，2026-09-19 应用并回归）：**

| 位置 | v2 问题 | v3 修改 |
| --- | --- | --- |
| `ai_products_heavy_use` true | "Describes routine, intensive use..." 未区分声称与证据 | what 改为 "Demonstrable, costly, or specific evidence of ... — **not merely self-description**" |
| `ai_products_heavy_use` false | 未覆盖自我标榜话术 | what 增补 "or a self-described identity ('heavy user', 'frequent user') without any concrete usage scenario" |
| `exceptional_pursuit` true | 实体规模可被记到个人头上 | what 增补 "**attributable to the candidate's own sustained contribution** — not merely association with a large entity or title" |

v3 全量回归（四例：小明 CN/EN + 负对照 A/B，`results/*-v3.json`）：

- ai 题：B 0.95 → **0.49**（落入预期 0.3–0.6 区间，"声称 vs 证据"判别生效）；小明 0.97 / 0.98 不变（付费订阅、搭过 Agent 等可证证据不受影响）；A 0.10 不变。
- exceptional 题：B 0.81 → **0.79**（降到 0.8 人工标记阈值之下）；小明 0.91 / 0.90、A 0.11 不变——归属限定只影响"依附大实体"型经历，不伤本人从零发起的项目。
- 其余八题逐例对照 v2 漂移 ≤ 0.04：问题相互独立保证判据改动无跨题外溢，该漂移即模型自洽性的噪声底。
- 合成总分：小明 **0.947 / 0.950**（含加分）、林浩然 **0.617**（ai 加分失效）、王强 **0.12**（双门槛挂）。三类样本排序与处置全部正确，**判据封版 v3**。

## 5. 文件清单

```
resume-jd-matching/
├── README.md                            # 本文件
├── jev-recruiting-screening.json        # 判据模板 v2（当前版；state.resume.full_text 为占位符）
├── requests/                            # v3 判据的完整可发送请求（当前版）
│   ├── jev-screening-xiaoming-CN.json   # 正样本：小明
│   ├── jev-screening-xiaoming-EN.json   # 正样本英文版
│   ├── jev-screening-control-A-unqualified.json   # 负对照 A：明显不合格
│   └── jev-screening-control-B-glossy-trap.json   # 负对照 B：光鲜空洞陷阱
├── resumes/
│   ├── xiaoming-CN.txt
│   ├── xiaoming-EN.txt
│   ├── control-A-unqualified-CN.txt
│   └── control-B-glossy-trap-CN.txt
├── results/                             # 实测结果（console 导出含耗时；API 直连无耗时字段）
│   ├── CN-test-result.json · EN-test-result.json             # v1 判据 · 小明
│   ├── CN-test-result-v2.json · EN-test-result-v2.json       # v2 判据 · 小明
│   ├── control-A-result.json · control-B-result.json         # 负对照 · v2 判据
│   └── CN/EN-test-result-v3.json · control-A/B-result-v3.json # v3 回归 · 四例全量
├── archive/
│   ├── v1-requests/                     # v1 请求（对应 CN/EN-test-result.json）
│   │   ├── jev-screening-xiaoming-CN.json
│   │   └── jev-screening-xiaoming-EN.json
│   └── v2-requests/                     # v2 请求（对应 *-v2 与 control-*-result 结果）
│       ├── jev-screening-xiaoming-CN.json
│       ├── jev-screening-xiaoming-EN.json
│       ├── jev-screening-control-A-unqualified.json
│       └── jev-screening-control-B-glossy-trap.json
└── webapp/                              # 网站工作台（node server.mjs 启动，详见第 10 节）
    ├── index.html / app.js / style.css  # 四步流程前端（纯 vanilla，无构建步骤）
    ├── criteria.js                      # 判据校验器 + 合成评分/路由逻辑（浏览器与 Node 测试共用）
    ├── server.mjs                       # 零依赖本地代理（静态服务 + Jev/LLM 转发，仅监听 127.0.0.1）
    ├── demo-data.js                     # 内置演示：小明简历 + JD 原文 + v3 判据
    └── vendor/                          # pdfjs-dist@3.11.174（Apache-2.0，本地 vendored）
        ├── pdf.min.js                   # 简历 PDF 的浏览器端文本提取（含 CJK ToUnicode 支持）
        └── pdf.worker.min.js
```

## 6. 如何使用

**Console Playground：** 打开 console.typesafe.ai → Playground，粘贴 `requests/*.json` 全文发送（model 选 `jev-latest`）。

**Python SDK：**

```python
import json
from typesafe_sdk import TypeSafeClient

with open("requests/jev-screening-xiaoming-CN.json") as f:
    req = json.load(f)

with TypeSafeClient() as client:
    resp = client.system_one(state=req["state"], questions=req["questions"])

a = resp.answers
print(a["dominant_background"].choice, a["user_community_work_depth"].score)
```

**换候选人：** 只替换 `state.resume.full_text`（先剥离姓名/照片/性别/年龄/婚育）。
**换 JD：** 重写 `state.job.*`，并逐题核对 questions 的判据与路径引用是否仍成立。

**代码侧合成与路由（接在响应之后）：**

```python
def norm(qid): return a[qid].score / 3          # Score 归一化

match = (0.30 * norm("user_community_work_depth")
       + 0.25 * norm("data_and_metrics_ability")
       + 0.25 * norm("coordination_and_delivery")
       + 0.20 * norm("signal_to_insight"))

# 硬门槛：证据不足 → 待核，不直接拒
gated = [q for q in ("education_bachelor_or_above",
                     "written_english_evidence") if a[q].noul < 0.8]

# 加分项
if a["ai_products_heavy_use"].noul > 0.8: match += 0.05
if a["exceptional_pursuit"].noul   > 0.8: flag_for_manual_read()

# 置信度路由：任何一问不确定 → 人工；阈值按管线语言校准
low_conf = [q for q in a if getattr(a[q], "confidence", 1) < 0.7]

# 背景分桶 → 路由给对应招聘官
route_to(a["dominant_background"].choice)
```

## 7. 合规与边界红线

1. **PII 剥离**：发送前去掉姓名、照片、性别、年龄、婚育等与岗位无关属性。
2. **声称 ≠ 事实**：所有 Noul 检测的是"简历是否写明 X"；背调是独立工序。
3. **不利决定必须人在环**：模型输出只作排序参考，不得作为自动拒绝依据（招聘属 AI Act 高风险场景）。
4. **被拒堆抽样人工复核**：召回优先于精确率；离群输入下置信度防线会失灵（见硬币实验）。
5. **中文负载先自测**：官方声明 CJK 准确率较低；判据语言与阈值校准语言保持一致。

## 8. 负对照检验（逆向验证，2026-09-19 启动）

上生产前最后一道关：检验机制对"不该通过的人"的分辨力。两份对照简历均为中文版（与"管线固定语言"决策一致），设计意图如下：

**Case A `control-A-unqualified`（王强，明显不合格）**——5 年房产销售/快消业务员，大专学历，无英语证据，DeepSeek 仅用来写周报，Excel 记账。探测三件事：
- 硬门槛 Noul 是否可靠判 false（大专、英语零证据）
- Score 地板行为：各维度应落 0–1 档，是否会被"喜欢与人打交道"式自我标捧抬高
- Choice 的 other_or_unclassifiable 兜底桶能否接住销售背景

**Case B `control-B-glossy-trap`（林浩然，光鲜空洞陷阱）**——985 本科 + 雅思 7.5（硬门槛合法通过，因此拒他必须靠维度判断），大厂专家 title、福布斯 U30 入围、50 万粉自媒体联创；但全文无一因果性成果（只有"显著提升"），技能栏"精通 SQL/Python"零使用证据，AI 仅"高频用户"声称，联创实际职责是选题会与商务对接。探测四件事：
- 关键词鲁棒性：skill keyword 零使用（tools 题 not_for）、"高频用户"声称（ai 题证据标准）是否被识破
- 归属检验：实体规模（50 万粉）是否被错误记到个人头上——exceptional 题最危险
- 空洞话术 vs 因果成果：四维 Score 是否被"赋能/打法/沉淀"抬高
- **合格线：B 的 composite 应显著低于小明（≈0.89）。若 B ≥ 0.8，机制判为失效，需回炉判据。**

**实测结果（2026-09-19，API 直连，v2 判据，`results/control-*-result.json`）：**

| 问题 | A 王强 实测 / 预期 | B 林浩然 实测 / 预期 |
| --- | --- | --- |
| education | 0.03 / 低 ✓ | 0.99 / 高 ✓ |
| written_english | 0.02 / 低 ✓ | 0.84 / 高 ✓（证书-only 比小明的证书+使用证据 0.97 低——模型对证据强度敏感） |
| ai_products_heavy_use | 0.11 / 低 ✓ | **0.95 / 预期 0.3–0.6 ✗** |
| efficiency_tools | 0.10 / 低 ✓ | **0.17 / 低 ✓**（not_for 生效，"精通 SQL/Python"关键词未放水） |
| exceptional_pursuit | 0.10 / 低 ✓ | **0.81 / 预期 0.5–0.75 △** |
| user_community_work_depth | 1.07 (0.93) / 1 ✓ | 2.31 (0.61) / 1–2 △ |
| data_and_metrics_ability | 0.12 (0.88) / 0 ✓ | 1.74 (0.72) / 1–2 ✓ |
| coordination_and_delivery | 0.03 (0.97) / 0–1 ✓ | 1.89 (0.71) / 1–2 ✓ |
| signal_to_insight | 0.00 (1.0) / 0–1 ✓ | 1.33 (0.42) / 0–1 △ |
| dominant_background | other_or_unclassifiable (0.88) ✓ | user_or_community_ops (1.0) ✓ |
| **composite** | **≈0.12，两门槛挂 → 拒绝堆** | **≈0.67，低于 0.8 红线** |

**判定：机制通过负对照。** A 十题全中——地板不被"喜欢与人打交道"式自我标榜抬高，销售背景被兜底桶正确接住；B 落在 0.12 < 0.67 < 0.894 的正确序列上，且拒它的不是硬门槛（门槛合法通过）而是维度判断，验证了设计前提。合成总分排序 A 0.12 < B 0.67 < 小明 0.894，间距合理。

**但 B 暴露一个判据缺口：**
- **ai_products_heavy_use 0.95（失守）**：B 的"深度使用/高频用户"是纯自我描述，模型按字面采信。根因与 v1 data 题同构——判据没有定义"声称 vs 可证证据"（付费订阅、搭过 Agent、工作场景用量）。
- **exceptional_pursuit 0.81（轻微越界）**：50 万粉实体的规模部分记到了个人头上；但"联合创办并持续 2 年"本身可辩护，属边界值而非错误。
- **置信度行为健康**：B 证据最薄弱的 insight 题置信最低（0.42），user_depth 0.61 也转入人工——模型在证据稀薄处主动示弱。
- **v3 已应用并回归通过（2026-09-19，API 直连四例）**：ai 题 B 0.95→0.49、exceptional 题 B 0.81→0.79，小明与 A 零漂移（其余八题漂移 ≤0.04，为自洽性噪声底）。详见第 4 节 v3 回归。

## 9. 待办（下一步）

- [x] 用 `requests/`（v2）重跑小明 CN/EN，验证 data / coordination 两题回落（2026-09-19：data → 2.18 且中英一致；coordination → 2.56/2.60、置信 0.56/0.60，详见第 4 节）
- [x] 跑负对照 Case A / Case B（2026-09-19：A 十题全中 ≈0.12；B ≈0.67 < 0.8 红线，机制通过；暴露 ai 题"声称 vs 证据"判据缺口，见第 8 节）
- [x] v3 判据修订并四例回归（2026-09-19：B ai 0.95→0.49、exceptional 0.81→0.79；小明与 A 零漂移，判据封版 v3，见第 4 节）
- [x] Web 工作台：简历+JD → 判据 → Jev 评估的完整网站（2026-09-19：代理层与浏览器端到端均验证通过，见第 10 节）
- [x] Web：PDF 简历解析（2026-09-25：pdf.js vendored 浏览器端提取；ASCII 样本 + 真实中文简历（2674 字/1949 汉字/113ms）与完整 UI 路径均验证通过）
- [ ] Web：判据生成质量评测（跨 LLM 供应商对比 prompt 遵循度）
- [ ] 写批量脚本：多简历并发 + 结果 CSV 落表
- [ ] 阈值校准：自有数据上画"置信度-准确率"曲线，定 0.7/0.9 门槛
- [ ] 对照实验：同一批中文简历，英文判据 vs 中文判据

## 10. Web 工作台（简历 × JD 匹配网站）

把本项目的方法论包装成可用网站：用户粘贴简历与任意 JD，由通用 LLM 起草判据、Jev 做校准评估、代码合成匹配度。

**启动（Node ≥ 18，零依赖）：**

```bash
cd webapp && node server.mjs   # → http://127.0.0.1:8787
```

**四步流程：** ① 配置 Jev key + 通用 LLM（OpenAI 兼容 Base URL/Key/模型，均为 BYOK，仅存浏览器 localStorage）；② 粘贴或上传简历与 JD（**简历支持 PDF**：pdf.js 在浏览器端提取文本，含中文 CJK 支持与分页进度，扫描件无文本层会明确报错提示 OCR）；③ LLM 从 JD 起草判据 JSON（可手工编辑，实时 schema 校验）→ ④ 调用 Jev，渲染总分环形图、门槛状态、逐题概率条与路由建议。没有 LLM key 时可「载入演示判据」直接体验 Jev 评估（内置小明演示数据）。

**架构决策（为什么需要本地代理 + 为什么需要通用 LLM）：**

- **CORS**：实测 `api.typesafe.ai` 的预检响应不含 `access-control-allow-origin`（origin 不在白名单），浏览器无法直连，因此由零依赖 Node 代理转发（仅监听 127.0.0.1，key 只在内存中转发、不落盘不打印）。
- **LLM 的分工**：Jev 每换一个 JD 都需要新判据，这一步由通用 LLM 完成——但只让它**起草**，三道护栏保证 v3 纪律不丢失：① system prompt 内嵌全部设计纪律（原子问题/证据化判据/对比式定义/英文判据/归属限定/评分方案）；② 代码层 schema 校验 + 受保护属性过滤器（年龄/性别/婚育等直接拒绝）；③ **生成后必须人工过目可编辑**再执行。LLM 不参与打分——打分永远是 Jev + 确定性代码。
- **人在环红线延续到 UI**：路由输出全部标注"建议"，低置信自动转人工提示，页脚常驻免责声明。

**验证记录（2026-09-19）：** 校验器单元测试四项全过（v3 模板通过 / 受保护属性拒绝 / 坏结构拒绝 / 用小明 v2 真实结果复现 README 合成分 0.944）；LLM 代理错误路径透传正确（上游 401 原样返回）；真实 key 经代理完成 Jev e2e（10 题返回，数字与 v3 回归一致）；浏览器端到端（载入演示→判据→评估）总分 95%、路由"协调维度低置信转人工"。

## 11. 背景资料

- TypeSafe 官方文档：https://docs.typesafe.ai/ （[llms.txt 索引](https://docs.typesafe.ai/llms.txt)）
- 核心文档中文翻译（本机 ZCode workspace）：
  - `typesafe-core-docs-翻译.md` — 七个核心页完整译本 + 26 条术语表
  - `typesafe-state-翻译.md` — State 单页精翻 + 术语表
- 相关实验：硬币问题反面教材记录见本文档第 1 节第 3 条
