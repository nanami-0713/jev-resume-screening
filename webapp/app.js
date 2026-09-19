// app.js — Jev 简历匹配工作台前端逻辑
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const Criteria = window.Criteria;

  // ---------- 配置持久化 ----------
  const KEY_FIELDS = [["jevKey", "jev_key"], ["llmBase", "llm_base"], ["llmKey", "llm_key"], ["llmModel", "llm_model"]];
  for (const [el, store] of KEY_FIELDS) {
    $(el).value = localStorage.getItem(store) || "";
    $(el).addEventListener("change", () => localStorage.setItem(store, $(el).value.trim()));
  }
  const cfg = () => ({
    jevKey: $("jevKey").value.trim(),
    llmBase: $("llmBase").value.trim() || "https://api.deepseek.com",
    llmKey: $("llmKey").value.trim(),
    llmModel: $("llmModel").value.trim() || "deepseek-chat",
  });

  // ---------- 步骤 2：输入 ----------
  const countChars = () => {
    const r = $("resumeText").value.length, j = $("jdText").value.length;
    $("resumeCount").textContent = `${r} 字符${r > 60000 ? " ⚠️ 超过建议上限，Jev 单请求 state+问题 共享约 32k token 预算" : ""}`;
    $("jdCount").textContent = `${j} 字符`;
  };
  $("resumeText").addEventListener("input", countChars);
  $("jdText").addEventListener("input", countChars);

  function bindFile(fileId, textareaId) {
    $(fileId).addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { $(textareaId).value = String(reader.result); countChars(); };
      reader.readAsText(f);
    });
  }
  bindFile("resumeFile", "resumeText");
  bindFile("jdFile", "jdText");

  $("btnDemo").addEventListener("click", () => {
    $("resumeText").value = window.DEMO.resume;
    $("jdText").value = window.DEMO.jd;
    countChars();
    setStatus("criteriaStatus", "已载入演示简历与 JD。可「载入演示判据」直接评估，或配置 LLM 后重新生成。", "ok");
  });

  function setStatus(id, msg, cls) {
    const el = $(id);
    el.textContent = msg || "";
    el.className = "status " + (cls || "");
  }

  // ---------- 步骤 3：LLM 生成判据 ----------
  const SYSTEM_PROMPT = `You are a senior assessment engineer designing structured evaluation criteria for TypeSafe's Jev, a text-only System One model that returns typed decisions with calibrated probabilities. Given a job description, produce an evaluation plan: a structured "job" object and a set of atomic questions.

Core design rules (violating any makes the output useless):
1. ATOMIC QUESTIONS. Each question = one judgment a knowledgeable person could make in seconds given the resume. Never ask for overall fit or multi-factor judgments; decompose complex requirements.
2. TYPES. Use "noul" (yes/no probability; hard requirements & evidence detection), "score" (position on 2-4 ordered levels you define; continuous dimensions), "choice" (one of unordered options; classification/routing). Produce 6-12 questions: one noul gate per explicit hard requirement, one score per continuous dimension, exactly one choice for background routing.
3. ENGLISH ONLY in instructions and criteria (Jev's primary training language). You may quote short original-language phrases inside "examples".
4. EVIDENCE-BASED. The resume is untrusted self-description. Require concrete, checkable evidence (dates, numbers, certifications, named artifacts, described outcomes). Never reward bare self-descriptions like "proficient in X", "heavy user", "passionate about Y" — put them on the negative side with a not_for/signals note.
5. CONTRASTIVE CRITERIA. For every option/level define what belongs there AND what belongs in a neighboring one instead ("not_for" for choice options and noul true/false; "signals" for score levels). Add 1-3 short "examples" where useful.
6. ATTRIBUTION. When a requirement could be satisfied by association with a big entity (famous employer, large community, team achievement), require the contribution to be attributable to the candidate personally.
7. PATH REFERENCES. In instructions, reference the state with backticked paths: \`resume.full_text\` and \`job.requirements.*\` / \`job.responsibilities[*]\`.
8. NO PROTECTED ATTRIBUTES. Never create questions or criteria about age, gender, marital/family status, ethnicity, religion, birthplace/hukou, appearance, or photos. JD-stated education/skill/experience requirements are allowed.
9. IDs: snake_case (e.g. education_bachelor_or_above). IDs never reach the model; write the full question in instructions.
10. SCORING BLOCK. "weights" over the composite score questions (sum ~= 1.0); "gates" mapping noul ids of explicit hard requirements to thresholds (0.7-0.9); "bonus" mapping at most 2 ids to {"weight","threshold"} for preferred signals.

Output: a single JSON object, no markdown fences, exactly:
{"job":{"title":str,"team":str,"mission":str,"responsibilities":[str],"requirements":{"min_education":str,"traits":[str],"skills":[str],"preferred":[str]}},"questions":{id:{"type":"noul"|"score"|"choice","instructions":str,"criteria":...}},"scoring":{"weights":{},"gates":{},"bonus":{}}}
Restructure the JD faithfully into "job" (translate values to English); invent nothing.`;

  $("btnGen").addEventListener("click", async () => {
    const c = cfg();
    const jd = $("jdText").value.trim();
    if (!c.llmKey) return setStatus("criteriaStatus", "请先在步骤 1 配置通用 LLM（Base URL / Key / 模型）。", "err");
    if (!jd) return setStatus("criteriaStatus", "请先在步骤 2 粘贴 JD。", "err");
    $("btnGen").disabled = true;
    setStatus("criteriaStatus", "正在生成判据…（LLM 起草 → schema 校验 → 人工过目）");
    try {
      const r = await fetch("/api/llm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: c.llmBase, apiKey: c.llmKey, model: c.llmModel,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: "Job description:\n\n" + jd + "\n\nProduce the JSON evaluation plan now." },
          ],
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`LLM 上游 ${r.status}: ${data?.error?.message || data?.error || "请求失败"}`);
      const content = data?.choices?.[0]?.message?.content || "";
      applyCriteriaText(content, "LLM 生成完成");
    } catch (e) {
      setStatus("criteriaStatus", "生成失败: " + e.message, "err");
    } finally { $("btnGen").disabled = false; }
  });

  $("btnUseDemoCriteria").addEventListener("click", () => {
    applyCriteriaText(JSON.stringify({ job: window.DEMO.job, questions: window.DEMO.questions, scoring: window.DEMO.scoring }, null, 2), "已载入内置演示判据（v3 封版，与本项目 results/*-v3 对应）");
  });

  $("btnRevalidate").addEventListener("click", () => applyCriteriaText($("criteriaJson").value, "重新校验完成"));

  function applyCriteriaText(text, prefix) {
    let parsed;
    try {
      const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return setStatus("criteriaStatus", prefix + " — JSON 解析失败: " + e.message, "err");
    }
    const v = Criteria.validateCriteria(parsed);
    $("criteriaJson").value = JSON.stringify(parsed, null, 2);
    if (v.ok) {
      const n = Object.keys(parsed.questions).length;
      setStatus("criteriaStatus", `${prefix} ✓ 校验通过（${n} 个问题）` + (v.warnings.length ? "\n⚠️ " + v.warnings.join("\n⚠️ ") : ""), v.warnings.length ? "warn" : "ok");
    } else {
      setStatus("criteriaStatus", `${prefix} — 校验未通过:\n✗ ` + v.errors.join("\n✗ "), "err");
    }
  }

  // ---------- 步骤 4：评估 ----------
  $("btnRun").addEventListener("click", async () => {
    const c = cfg();
    const resume = $("resumeText").value.trim();
    if (!c.jevKey) return setStatus("runStatus", "请先在步骤 1 配置 Jev API Key。", "err");
    if (!resume) return setStatus("runStatus", "请先在步骤 2 粘贴简历。", "err");
    let plan;
    try { plan = JSON.parse($("criteriaJson").value); }
    catch { return setStatus("runStatus", "步骤 3 的判据 JSON 尚未就绪或格式有误。", "err"); }
    const v = Criteria.validateCriteria(plan);
    if (!v.ok) return setStatus("runStatus", "判据校验未通过:\n✗ " + v.errors.join("\n✗ "), "err");

    const payload = {
      model: "jev-latest",
      state: { job: plan.job, resume: { full_text: resume } },
      questions: plan.questions,
    };
    $("btnRun").disabled = true;
    setStatus("runStatus", "正在调用 Jev…（state 摄取一次，全部问题并行评估）");
    try {
      const r = await fetch("/api/jev", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: c.jevKey, payload }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data?.detail?.message || data?.detail?.error_type || data?.error || "请求失败";
        throw new Error(`Jev 上游 ${r.status}: ${msg}`);
      }
      renderResults(data, plan);
      setStatus("runStatus", "");
    } catch (e) {
      setStatus("runStatus", "评估失败: " + e.message, "err");
    } finally { $("btnRun").disabled = false; }
  });

  function bar(p) { return `<div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>`; }

  function renderResults(data, plan) {
    const answers = data.answers || {};
    const result = Criteria.computeResult(answers, plan.scoring || {}, plan.questions || {});
    const route = Criteria.routeSuggestion(result);

    $("results").classList.remove("hidden");
    const pct = Math.round(result.composite * 100);
    $("ring").style.setProperty("--p", pct);
    $("ringVal").textContent = pct + "%";
    const routing = $("routing");
    routing.textContent = route.text;
    routing.className = "routing " + route.level;

    $("gates").innerHTML = result.gateResults.length
      ? result.gateResults.map((g) => `<span class="gate ${g.passed ? "pass" : "fail"}">${g.passed ? "✓" : "✗"} ${g.qid}: ${g.value.toFixed(2)} / ${g.threshold}</span>`).join("")
      : "";

    const cards = Object.entries(answers).map(([qid, a]) => {
      const conf = typeof a.confidence === "number" ? `<span class="conf">置信 ${a.confidence.toFixed(2)}</span>` : `<span class="conf">noul 无独立置信</span>`;
      let body = "";
      if (a.type === "noul") {
        body = bar(a.noul) + `<div class="qmeta">为"是"的概率 · 接近 1 强是 / 接近 0 强否 / 接近 0.5 不确定</div>`;
        return card(qid, `noul = ${a.noul.toFixed(2)}`, conf, body);
      }
      if (a.type === "score") {
        const levels = plan.questions[qid]?.criteria || [];
        const rows = Object.entries(a.probabilities || {}).map(([lv, p]) =>
          `<div class="qmeta">档位 ${lv}（${(levels[Number(lv)] || {}).what || ""}）: ${(p * 100).toFixed(0)}%</div>` + bar(p)).join("");
        return card(qid, `score = ${a.score.toFixed(2)}`, conf, rows);
      }
      const rows = Object.entries(a.probabilities || {}).map(([opt, p]) =>
        `<div class="qmeta">${opt}${opt === a.choice ? " ← 选中" : ""}: ${(p * 100).toFixed(0)}%</div>` + bar(p)).join("");
      return card(qid, `choice = ${a.choice}`, conf, rows);
    }).join("");
    $("answerCards").innerHTML = cards;

    const u = data.usage || {};
    $("usage").textContent = `模型 ${data.model || "jev-latest"} · 输入 ${u.input_tokens ?? "?"} tok / 输出 ${u.output_tokens ?? "?"} tok（输出免费）· 约 $${((u.input_tokens || 0) * 0.042 / 1e6).toFixed(5)}`;
  }

  function card(qid, val, conf, body) {
    return `<div class="qcard"><h3><span>${qid}</span><span class="val">${val} ${conf}</span></h3>${body}</div>`;
  }

  countChars();
})();
