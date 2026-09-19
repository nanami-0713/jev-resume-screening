// criteria.js — 判据校验器与合成评分逻辑（浏览器与 Node 测试共用）
// 设计纪律来源：本项目 README 第 2/4 节（v3 判据规则）
(function (root) {
  "use strict";

  const PROTECTED = /(年龄|\bage\b|\bage:|性别|\bgender\b|男|女|婚育|婚姻|married|marital|生育|民族|ethnic|religion|宗教|籍贯|户口|hukou|photo|照片|长相|外貌|appearance)/i;
  const ID_RE = /^[a-z][a-z0-9_]*$/;

  function isStr(x) { return typeof x === "string" && x.trim().length > 0; }

  // 校验 LLM 生成的判据 JSON。返回 {ok, errors, warnings, parsed}
  function validateCriteria(parsed) {
    const errors = [];
    const warnings = [];
    if (!parsed || typeof parsed !== "object") return { ok: false, errors: ["输出不是 JSON 对象"], warnings, parsed };

    // ---- job ----
    const job = parsed.job;
    if (!job || typeof job !== "object") errors.push("缺少 job 对象");
    else {
      if (!isStr(job.title)) warnings.push("job.title 缺失或为空");
      if (!Array.isArray(job.responsibilities) || job.responsibilities.length === 0) warnings.push("job.responsibilities 为空");
      if (!job.requirements || typeof job.requirements !== "object") warnings.push("job.requirements 缺失");
    }

    // ---- questions ----
    const qs = parsed.questions;
    if (!qs || typeof qs !== "object" || Array.isArray(qs)) {
      errors.push("缺少 questions 对象");
      return { ok: errors.length === 0, errors, warnings, parsed };
    }
    const ids = Object.keys(qs);
    if (ids.length < 4 || ids.length > 15) errors.push(`问题数量应为 4–15，当前 ${ids.length}`);
    const typeCount = { noul: 0, score: 0, choice: 0 };
    for (const id of ids) {
      if (!ID_RE.test(id)) { errors.push(`问题 ID 不合法: ${id}（需 snake_case）`); continue; }
      const q = qs[id];
      if (!q || typeof q !== "object") { errors.push(`${id}: 不是对象`); continue; }
      if (!["noul", "score", "choice"].includes(q.type)) { errors.push(`${id}: type 必须是 noul/score/choice`); continue; }
      typeCount[q.type]++;
      if (!isStr(q.instructions)) { errors.push(`${id}: instructions 缺失`); continue; }
      if (PROTECTED.test(q.instructions)) { errors.push(`${id}: instructions 涉及受保护属性（年龄/性别/婚育等），已拒绝`); continue; }
      if (!/`resume\.full_text`|`job\./.test(q.instructions)) warnings.push(`${id}: instructions 未用反引号路径引用 \`resume.full_text\` 或 \`job.*\``);
      const c = q.criteria;
      if (q.type === "noul") {
        if (c !== undefined) {
          if (typeof c !== "object" || Array.isArray(c)) { errors.push(`${id}: noul criteria 应为对象`); continue; }
          for (const side of ["true", "false"]) {
            if (c[side] && !isStr(c[side].what)) errors.push(`${id}: criteria.${side}.what 缺失`);
          }
        }
      } else if (q.type === "score") {
        if (!Array.isArray(c) || c.length < 2 || c.length > 6) { errors.push(`${id}: score criteria 需为 2–6 个档位的数组`); continue; }
        for (const lv of c) if (!lv || !isStr(lv.what)) { errors.push(`${id}: 每个档位需要 what 字段`); break; }
      } else { // choice
        if (!c || typeof c !== "object" || Array.isArray(c)) { errors.push(`${id}: choice criteria 应为选项对象`); continue; }
        const opts = Object.keys(c);
        if (opts.length < 2 || opts.length > 12) { errors.push(`${id}: choice 选项需 2–12 个`); continue; }
        for (const o of opts) if (!c[o] || !isStr(c[o].what)) { errors.push(`${id}: 选项 ${o} 缺 what`); break; }
      }
      // 受保护属性扫描（判据全字段）
      const flat = JSON.stringify(q.criteria || {});
      if (PROTECTED.test(flat)) errors.push(`${id}: criteria 涉及受保护属性，已拒绝`);
    }
    if (typeCount.score === 0 && typeCount.noul === 0) errors.push("至少需要一个 noul 或 score 问题");
    if (typeCount.choice > 2) warnings.push("choice 问题超过 2 个，通常一个背景分桶就够");

    // ---- scoring ----
    let scoring = parsed.scoring;
    if (!scoring || typeof scoring !== "object") {
      warnings.push("缺少 scoring 块，将回退为等权合成（无门槛、无加分）");
      scoring = { weights: {}, gates: {}, bonus: {} };
      for (const id of ids) if (qs[id] && qs[id].type === "score") scoring.weights[id] = 1;
    }
    const wKeys = Object.keys(scoring.weights || {});
    if (wKeys.length === 0) errors.push("scoring.weights 为空");
    let wSum = 0;
    for (const k of wKeys) {
      if (!qs[k]) { errors.push(`scoring.weights 引用了不存在的问题: ${k}`); continue; }
      const w = Number(scoring.weights[k]);
      if (!(w >= 0 && w <= 1)) errors.push(`scoring.weights.${k} 应在 0–1`);
      wSum += w || 0;
    }
    if (wSum > 0 && (wSum < 0.85 || wSum > 1.15)) warnings.push(`weights 之和为 ${wSum.toFixed(2)}，将自动归一化`);
    for (const [k, v] of Object.entries(scoring.gates || {})) {
      if (!qs[k] || qs[k].type !== "noul") errors.push(`scoring.gates.${k} 必须指向 noul 问题`);
      else if (!(Number(v) >= 0.5 && Number(v) <= 0.95)) errors.push(`scoring.gates.${k} 阈值应在 0.5–0.95`);
    }
    for (const [k, v] of Object.entries(scoring.bonus || {})) {
      if (!qs[k]) errors.push(`scoring.bonus 引用了不存在的问题: ${k}`);
      else if (!v || !(Number(v.weight) >= 0) || !(Number(v.threshold) >= 0.5 && Number(v.threshold) <= 0.95)) errors.push(`scoring.bonus.${k} 需要 {weight, threshold(0.5–0.95)}`);
    }

    return { ok: errors.length === 0, errors, warnings, parsed };
  }

  // 依据 answers + scoring 计算合成结果
  // answers: Jev 响应的 answers 对象
  function computeResult(answers, scoring, questions) {
    const weights = scoring.weights || {};
    const gates = scoring.gates || {};
    const bonus = scoring.bonus || {};
    const wSum = Object.values(weights).reduce((s, w) => s + Number(w || 0), 0) || 1;

    let composite = 0;
    for (const [qid, w] of Object.entries(weights)) {
      const a = answers[qid];
      if (!a) continue;
      const norm = a.type === "score"
        ? (() => { const maxLevel = (questions[qid]?.criteria?.length || 4) - 1; return maxLevel > 0 ? a.score / maxLevel : 1; })()
        : a.type === "noul" ? a.noul : (a.choice ? 1 : 0);
      composite += (Number(w) / wSum) * norm;
    }
    for (const [qid, cfg] of Object.entries(bonus)) {
      const a = answers[qid];
      if (a && ((a.type === "noul" && a.noul >= Number(cfg.threshold)) || (a.type !== "noul" && a.confidence >= Number(cfg.threshold)))) {
        composite += Number(cfg.weight || 0);
      }
    }
    composite = Math.max(0, Math.min(1, composite));

    const gateResults = [];
    for (const [qid, thr] of Object.entries(gates)) {
      const a = answers[qid];
      if (!a) continue;
      const v = a.type === "noul" ? a.noul : a.confidence ?? 0;
      gateResults.push({ qid, value: v, threshold: Number(thr), passed: v >= Number(thr) });
    }
    const lowConf = [];
    for (const [qid, a] of Object.entries(answers)) {
      if (a.type === "noul") { if (a.noul >= 0.35 && a.noul <= 0.65) lowConf.push({ qid, reason: `noul=${a.noul.toFixed(2)} 处于不确定带` }); }
      else if (typeof a.confidence === "number" && a.confidence < 0.7) lowConf.push({ qid, reason: `confidence=${a.confidence.toFixed(2)}` });
    }
    return { composite, gateResults, lowConf };
  }

  // 路由建议（人在环红线：任何自动结论都只是建议）
  function routeSuggestion(result) {
    const failed = result.gateResults.filter((g) => !g.passed);
    const nearMiss = result.gateResults.filter((g) => g.passed && g.value < g.threshold + 0.1);
    if (failed.length > 0) return { level: "review", text: `硬门槛未过/证据不足（${failed.map((g) => g.qid).join("、")}）→ 转人工复核，不得自动拒绝` };
    if (result.lowConf.length > 0) return { level: "review", text: `存在低置信判断（${result.lowConf.map((x) => x.qid).join("、")}）→ 相关维度转人工确认` };
    if (result.composite >= 0.75) return { level: "proceed", text: "合成匹配度高 → 建议推进（最终决定请由招聘官做出）" };
    if (result.composite >= 0.5) return { level: "manual", text: "中等匹配 → 建议人工评估后决定" };
    return { level: "reject-pile", text: "匹配度低 → 建议放入拒绝堆（务必抽样人工复核）" };
  }

  const api = { validateCriteria, computeResult, routeSuggestion, PROTECTED };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Criteria = api;
})(typeof window !== "undefined" ? window : globalThis);
