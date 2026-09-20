// app.js — Jev 简历匹配工作台前端逻辑（编辑部风格 UI）
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const Criteria = window.Criteria;

  // ---------- 配置（localStorage + 设置弹窗） ----------
  const KEY_FIELDS = [["jevKey", "jev_key"], ["llmBase", "llm_base"], ["llmKey", "llm_key"], ["llmModel", "llm_model"]];
  for (const [el, store] of KEY_FIELDS) {
    $(el).value = localStorage.getItem(store) || "";
    $(el).addEventListener("change", () => { localStorage.setItem(store, $(el).value.trim()); refreshPill(); });
  }
  const cfg = () => ({
    jevKey: $("jevKey").value.trim(),
    llmBase: $("llmBase").value.trim() || "https://api.deepseek.com",
    llmKey: $("llmKey").value.trim(),
    llmModel: $("llmModel").value.trim() || "deepseek-chat",
  });

  function refreshPill() {
    const has = !!cfg().jevKey;
    $("statusPillText").textContent = has ? "Jev 就绪" : "未配置 Key";
    $("statusPill").querySelector(".dot").className = "dot" + (has ? "" : " off");
  }
  refreshPill();

  const modal = $("settingsModal");
  $("btnSettings").addEventListener("click", () => modal.showModal());
  $("btnCloseSettings").addEventListener("click", () => modal.close());
  $("btnSaveSettings").addEventListener("click", () => {
    for (const [el, store] of KEY_FIELDS) localStorage.setItem(store, $(el).value.trim());
    refreshPill();
    modal.close();
  });

  function setStatus(id, msg, cls) {
    const el = $(id);
    el.textContent = msg || "";
    el.className = "status " + (cls || "");
  }

  // ---------- 输入区 ----------
  const countChars = () => {
    const r = $("resumeText").value.length, j = $("jdText").value.length;
    $("resumeCount").textContent = `${r} 字`;
    $("jdCount").textContent = `${j} 字`;
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

  $("btnClear").addEventListener("click", () => {
    $("resumeText").value = ""; $("jdText").value = ""; countChars();
    setStatus("runStatus", ""); setStatus("criteriaStatus", "");
  });

  $("btnDemo").addEventListener("click", () => {
    $("resumeText").value = window.DEMO.resume;
    $("jdText").value = window.DEMO.jd;
    countChars();
  });

  // ---------- 判据 ----------
  let criteriaValid = false;

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

  function applyCriteriaText(text, prefix) {
    let parsed;
    try {
      const cleaned = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      criteriaValid = false;
      return setStatus("criteriaStatus", prefix + " — JSON 解析失败: " + e.message, "err");
    }
    const v = Criteria.validateCriteria(parsed);
    $("criteriaJson").value = JSON.stringify(parsed, null, 2);
    if (v.ok) {
      criteriaValid = true;
      const n = Object.keys(parsed.questions).length;
      setStatus("criteriaStatus", `${prefix} ✓ 校验通过（${n} 个问题）` + (v.warnings.length ? "\n⚠️ " + v.warnings.join("\n⚠️ ") : ""), v.warnings.length ? "warn" : "ok");
    } else {
      criteriaValid = false;
      setStatus("criteriaStatus", `${prefix} — 校验未通过:\n✗ ` + v.errors.join("\n✗ "), "err");
    }
    updateConfirmBtn();
    return v;
  }

  async function generateCriteria() {
    const c = cfg();
    const jd = $("jdText").value.trim();
    if (!c.llmKey) { openSettings("生成判据需要通用 LLM 的 key"); return null; }
    if (!jd) { setStatus("criteriaStatus", "请先粘贴岗位 JD。", "err"); return null; }
    setStatus("criteriaStatus", "正在用 LLM 起草判据…（LLM 提议 → schema 校验 → 你来处置）", "warn");
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
    $("criteriaCard").classList.remove("hidden");
    $("criteriaCard").scrollIntoView({ behavior: "smooth", block: "start" });
    const v = applyCriteriaText(content, "LLM 生成完成");
    if (v && !v.ok) throw new Error("LLM 草稿未通过校验，请手工修正或重新生成");
    return v;
  }

  let plan = null; // 当前已校验的判据计划
  function updateConfirmBtn() {
    $("btnConfirmEval").classList.toggle("hidden", !criteriaValid);
  }
  $("btnRevalidate").addEventListener("click", () => {
    const v = applyCriteriaText($("criteriaJson").value, "重新校验完成");
    if (v && v.ok) plan = v.parsed;
  });
  $("btnUseDemoCriteria").addEventListener("click", () => {
    $("criteriaCard").classList.remove("hidden");
    const v = applyCriteriaText(JSON.stringify({ job: window.DEMO.job, questions: window.DEMO.questions, scoring: window.DEMO.scoring }, null, 2), "已载入演示判据（v3 封版）");
    if (v && v.ok) plan = v.parsed;
  });
  $("btnGen").addEventListener("click", () => { generateCriteria().catch((e) => setStatus("criteriaStatus", "生成失败: " + e.message, "err")); });
  $("btnConfirmEval").addEventListener("click", () => { if (criteriaValid) evaluate(true); });

  // ---------- 评估 ----------
  async function evaluate(confirmed) {
    const c = cfg();
    const resume = $("resumeText").value.trim();
    if (!c.jevKey) { openSettings("调用 Jev 需要配置 Jev API Key"); return; }
    if (!resume) { setStatus("runStatus", "请先粘贴候选人简历。", "err"); return; }
    if (!criteriaValid || !plan) {
      setStatus("runStatus", "判据尚未就绪：先生成或载入判据并过目确认。", "err");
      return;
    }

    const payload = {
      model: "jev-latest",
      state: { job: plan.job, resume: { full_text: resume } },
      questions: plan.questions,
    };
    $("btnRun").disabled = true;
    const t0 = performance.now();
    const sw = $("stopwatch");
    const tick = setInterval(() => {
      const el = performance.now() - t0;
      const mm = String(Math.floor(el / 60000)).padStart(2, "0");
      const ss = String(Math.floor((el % 60000) / 1000)).padStart(2, "0");
      const cc = String(Math.floor((el % 1000) / 10)).padStart(2, "0");
      sw.textContent = `${mm}:${ss}.${cc}`;
    }, 50);
    setStatus("runStatus", "Jev 正在并行评估全部问题…");
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
      $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      setStatus("runStatus", "评估失败: " + e.message, "err");
    } finally {
      clearInterval(tick);
      $("btnRun").disabled = false;
    }
  }

  $("btnRun").addEventListener("click", () => {
    if (!criteriaValid || !plan) {
      // 先确保有判据：有 LLM key 就生成，没有就提示演示判据
      const c = cfg();
      if (!c.llmKey && !$("criteriaJson").value.trim()) {
        $("criteriaCard").classList.remove("hidden");
        $("criteriaCard").scrollIntoView({ behavior: "smooth" });
        setStatus("criteriaStatus", "还没有判据：配置 LLM 后「用 LLM 重新生成」，或点「载入演示判据」先体验。", "warn");
        return;
      }
      if (!c.llmKey) {
        $("criteriaCard").classList.remove("hidden");
        $("criteriaCard").scrollIntoView({ behavior: "smooth" });
        setStatus("criteriaStatus", "判据 JSON 已就绪但未通过校验，请修正后点「确认并评估」。", "warn");
        return;
      }
      generateCriteria()
        .then((v) => {
          if (v && v.ok) { plan = v.parsed; evaluate(true); }
        })
        .catch((e) => setStatus("criteriaStatus", "生成失败: " + e.message, "err"));
      return;
    }
    evaluate(true);
  });

  // ⌘/Ctrl + Enter 直接开始匹配
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("btnRun").click();
  });

  function openSettings(reason) {
    if (reason) $("btnSettings").textContent = `⚙ 配置 Keys（${reason}）`;
    modal.showModal();
  }

  // ---------- 结果渲染 ----------
  function bar(p, lime) { return `<div class="bar${lime ? " lime" : ""}"><i style="width:${Math.round(p * 100)}%"></i></div>`; }

  function renderResults(data, thePlan) {
    const answers = data.answers || {};
    const result = Criteria.computeResult(answers, thePlan.scoring || {}, thePlan.questions || {});
    const route = Criteria.routeSuggestion(result);

    $("results").classList.remove("hidden");
    const pct = Math.round(result.composite * 100);
    $("scoreBig").innerHTML = `${pct}<span>%</span><em>合成匹配度</em>`;
    const routing = $("routing");
    routing.textContent = route.text;
    routing.className = "routing " + route.level;

    $("gates").innerHTML = result.gateResults.length
      ? result.gateResults.map((g) => `<span class="gate ${g.passed ? "pass" : "fail"}">${g.passed ? "✓" : "✗"} ${g.qid} ${g.value.toFixed(2)} ≥ ${g.threshold}</span>`).join("")
      : "";

    const cards = Object.entries(answers).map(([qid, a], idx) => {
      const conf = typeof a.confidence === "number"
        ? `<small>置信 ${a.confidence.toFixed(2)}</small>`
        : `<small>noul 无独立置信</small>`;
      let body = "";
      if (a.type === "noul") {
        body = `<div class="lvl">为"是"的概率 <b>${a.noul.toFixed(2)}</b></div>` + bar(a.noul, true)
          + `<div class="qmeta">接近 1 强是 · 接近 0 强否 · 接近 0.5 不确定</div>`;
        return accCard(qid, `noul ${a.noul.toFixed(2)}`, (a.noul >= 0.35 && a.noul <= 0.65), conf, body, idx);
      }
      if (a.type === "score") {
        const levels = thePlan.questions[qid]?.criteria || [];
        const rows = Object.entries(a.probabilities || {}).map(([lv, p]) =>
          `<div class="lvl">档位 ${lv} · ${(levels[Number(lv)] || {}).what || ""} <b>${(p * 100).toFixed(0)}%</b></div>` + bar(p, Number(lv) === Math.round(a.score))).join("");
        return accCard(qid, `score ${a.score.toFixed(2)}`, (typeof a.confidence === "number" && a.confidence < 0.7), conf, rows, idx);
      }
      const rows = Object.entries(a.probabilities || {}).map(([opt, p]) =>
        `<div class="lvl">${opt}${opt === a.choice ? " ← 选中" : ""} <b>${(p * 100).toFixed(0)}%</b></div>` + bar(p, opt === a.choice)).join("");
      return accCard(qid, a.choice, false, conf, rows, idx);
    }).join("");
    $("answerList").innerHTML = cards;
    bindAccordion($("answerList"));

    const u = data.usage || {};
    $("usage").textContent = `${data.model || "jev-latest"} · 输入 ${u.input_tokens ?? "?"} tok（输出免费）· ≈ $${((u.input_tokens || 0) * 0.042 / 1e6).toFixed(5)}`;
  }

  function accCard(qid, val, warn, conf, body, idx) {
    return `<div class="acc" data-acc>
      <div class="acchead"><b>${qid}${conf}</b><span class="accval${warn ? " warn" : ""}">${val}</span><button class="accbtn" aria-label="展开">+</button></div>
      <div class="accbody hidden">${body}</div>
    </div>`;
  }

  function bindAccordion(root) {
    root.querySelectorAll("[data-acc] .acchead").forEach((head) => {
      head.addEventListener("click", () => {
        const acc = head.parentElement;
        const body = acc.querySelector(".accbody");
        const btn = acc.querySelector(".accbtn");
        const open = acc.classList.toggle("open");
        body.classList.toggle("hidden", !open);
        btn.textContent = open ? "−" : "+";
      });
    });
  }

  // ---------- FAQ（我们自己的边界说明） ----------
  const FAQ = [
    ["它看的是简历声称，还是事实？", "只看声称。Jev 评估的是「简历是否写明了某项经历/证据」，不核实真伪——背调是独立的工序。所以它适合初筛排序，不适合作为录用依据。"],
    ["换一个 JD 需要重新弄一遍吗？", "判据要换、且换得很快：LLM 会按新 JD 重新起草原子问题，你过目后执行。但维度体系与权重应按「岗位家族」沉淀复用（如用户运营类），而不是每个 JD 从零发明——权重变化应该慢，判据变化可以快。"],
    ["某个判断置信度很低时会怎样？", "机制不会替你猜。低于阈值的维度会明确标注并建议转人工确认；noul 落在 0.35–0.65 不确定带的判断同样会被标记。校准的意义就在于让模型能说「我不知道」。"],
    ["我的简历和 key 会离开本机吗？", "两把 key 仅存于你浏览器的 localStorage；简历文本只经本机代理转发给你自己配置的 API（api.typesafe.ai 与你选择的 LLM 端点），本服务不存储任何内容。TypeSafe 声明不用客户数据训练模型。"],
    ["为什么不能只看那个大百分比？", "因为总分是补偿性模型：维度间可以互相补分。所以机制先用硬门槛一票否决（非补偿结构），再用置信度路由拦住低把握判断，最后才轮到总分排序。三者缺一，总分就会被话术简历骗过——这是用陷阱简历实测过的。"],
    ["它能保证不漏掉好候选人吗？", "不能，没有任何初筛能。简历是候选人的自我描述，判据只能检测证据形态。所以被拒的候选人也应抽样人工复核——召回率比精确率更重要。"],
  ];
  $("faqList").innerHTML = FAQ.map(([q, a]) =>
    `<div class="acc" data-acc><div class="acchead"><b>${q}</b><button class="accbtn" aria-label="展开">+</button></div><div class="accbody hidden"><p>${a}</p></div></div>`).join("");
  bindAccordion($("faqList"));

  countChars();
  updateConfirmBtn();
})();
