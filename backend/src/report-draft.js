const { envNonEmpty } = require("./env");

function tidy(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function oneLine(text) {
  return tidy(text).replace(/\s+/g, " ");
}

function topicParticle(word) {
  const chars = [...String(word || "")];
  const ch = chars[chars.length - 1] || "";
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "은";
  return (code - 0xac00) % 28 === 0 ? "는" : "은";
}

function whoLabel(row) {
  return [row?.ownerName, row?.dept]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" · ");
}

function taskRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

function composeWeekSummary(companyName, rows) {
  const list = taskRows(rows);
  const name = String(companyName || "협력사").trim() || "협력사";
  const filled = list.filter((row) => oneLine(row.weeklyProgress || row.weeklySummary));
  if (!filled.length) {
    return "이번 주 과제별 금주 진전이 아직 없습니다. 참여자 주간보고를 확인한 뒤 이 초안을 보완해 주세요.";
  }
  const sentences = filled.map((row) => {
    const taskName = String(row.name || "과제").trim() || "과제";
    const who = whoLabel(row);
    let text = oneLine(row.weeklyProgress || row.weeklySummary);
    if (!/[.?!다요음임]$/.test(text)) text += ".";
    const whoPart = who ? ` ${who} 담당으로 ` : " ";
    return `${taskName}${topicParticle(taskName)}${whoPart}${text}`;
  });
  const missing = list
    .filter((row) => !oneLine(row.weeklyProgress || row.weeklySummary))
    .map((row) => String(row.name || "").trim())
    .filter(Boolean);
  let out = `${name} 금주 진행은 다음과 같습니다. ${sentences.join(" ")}`;
  if (missing.length) out += ` 금주 진전이 비어 있는 과제는 ${missing.join(", ")}입니다.`;
  return out;
}

function composeNextPlan(companyName, rows) {
  const list = taskRows(rows);
  const name = String(companyName || "협력사").trim() || "협력사";
  const filled = list.filter((row) => tidy(row.nextPlan || row.nextWeekPlan));
  if (!filled.length) {
    return "등록된 차주 계획이 없습니다. 참여자 주간보고의 차주 계획을 확인한 뒤 이 초안을 보완해 주세요.";
  }
  const lines = filled.map((row) => {
    const taskName = String(row.name || "과제").trim() || "과제";
    const who = whoLabel(row);
    const plans = tidy(row.nextPlan || row.nextWeekPlan)
      .split(/\n/)
      .map((line) => line.replace(/^[\s\-•●○☐☑]\s*/, "").trim())
      .filter(Boolean);
    return `- ${taskName}${who ? ` (${who})` : ""}: ${plans.join(", ")}`;
  });
  return `${name} 차주에는 아래 계획을 진행합니다.\n${lines.join("\n")}`;
}

const GEMINI_MODEL = "gemini-3.5-flash-lite";

function aiConfig() {
  const key = envNonEmpty("GEMINI_API_KEY")
    ? process.env.GEMINI_API_KEY.trim()
    : envNonEmpty("GOOGLE_API_KEY")
      ? process.env.GOOGLE_API_KEY.trim()
      : "";
  if (!key) return null;
  return { key, model: GEMINI_MODEL };
}

function narrativePayload(rows) {
  return taskRows(rows).map((row) => ({
    task: row.name || "",
    owner: row.ownerName || "",
    dept: row.dept || "",
    thisWeek: row.weeklyProgress || row.weeklySummary || "",
    nextWeek: row.nextPlan || row.nextWeekPlan || ""
  }));
}

function parseJsonContent(content) {
  const raw = String(content || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw;
  return JSON.parse(text);
}

function geminiResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && !part.thought && part.text)
    .map((part) => part.text)
    .join("");
}

async function requestAiNarratives(cfg, companyName, rows, useSchema) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": cfg.key
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "당신은 AX 컨설팅 주간보고 작성자입니다. 제공된 과제 내용만 사용하고, 없는 사실은 만들지 마세요. 한국어로 간결하게 작성하세요. 금주 요약과 차주 계획은 각각 공통 사항 및 특이점 중심의 3~4줄로 작성하세요. 각 줄은 핵심 문장 하나로 쓰고 실제 줄바꿈으로 구분하세요. JSON 객체만 반환하세요."
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  company: companyName || "협력사",
                  instruction:
                    "weekSummary는 thisWeek(금주 진전)만 근거로, nextWeekPlan은 nextWeek(차주 계획)만 근거로 각각 3~4줄로 작성하세요. 과제별 내용을 나열하지 말고 여러 과제의 공통 진행 사항 또는 공통 계획을 묶어 먼저 요약한 뒤, 중요한 특이점·성과·지연·위험·우선 확인 사항 중 입력에 근거가 있는 내용만 선별하세요. 공통 사항이 확인되지 않으면 개별 핵심 사항을 요약하고, 없는 공통점이나 특이점을 만들어내지 마세요. 중복 설명, 과제명·담당자 전수 나열, 제목과 번호는 생략하세요. 각 필드 문자열은 한 줄에 핵심 문장 하나씩 실제 줄바꿈을 포함하도록 작성하고, JSON에서는 줄바꿈을 올바르게 이스케이프하세요. 입력이 비어 있으면 미작성 또는 확인 필요 사실만 명시하고 임의의 성과나 계획을 추가하지 마세요.",
                  tasks: narrativePayload(rows)
                })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          ...(useSchema
            ? {
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    weekSummary: { type: "STRING" },
                    nextWeekPlan: { type: "STRING" }
                  },
                  required: ["weekSummary", "nextWeekPlan"]
                }
              }
            : {})
        }
      })
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(`Gemini narrative draft failed: ${response.status} ${detail.slice(0, 300)}`);
    return null;
  }
  const data = await response.json();
  const parsed = parseJsonContent(geminiResponseText(data));
  const weekSummary = tidy(parsed.weekSummary);
  const nextWeekPlan = tidy(parsed.nextWeekPlan);
  if (!weekSummary || !nextWeekPlan) return null;
  return { weekSummary, nextWeekPlan, source: "ai" };
}

async function tryAiNarratives(companyName, rows) {
  const cfg = aiConfig();
  if (!cfg) return null;
  try {
    return (
      (await requestAiNarratives(cfg, companyName, rows, true)) ||
      (await requestAiNarratives(cfg, companyName, rows, false))
    );
  } catch (err) {
    console.warn(`Gemini narrative draft failed: ${err?.message || err}`);
    return null;
  }
}

async function draftNarratives(companyName, rows) {
  const ai = await tryAiNarratives(companyName, rows);
  if (ai) return ai;
  return {
    weekSummary: composeWeekSummary(companyName, rows),
    nextWeekPlan: composeNextPlan(companyName, rows),
    source: "compiled"
  };
}

module.exports = {
  composeWeekSummary,
  composeNextPlan,
  draftNarratives
};
