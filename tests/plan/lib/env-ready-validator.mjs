// 用途：env-ready 校验器（TESTS-2026-10-03，TESTS.md §4.3）。
// 机制：S4→S5 的推进判据「人类逐条确认全绿」变成可判定 IO。ajv 缺席且禁 npm install（亲验），
// 故 schema 退化为「机器可读键清单」：{"<key>": {"type","enum"?,"pattern"?,"why"}}，校验器读同一 schema 驱动。
// L2 内容层：每项必须是「值+证据+时间戳」三元组（{value, evidence, at}）——只填结论不留证据 = 绿灯幻觉（PLAN §3.4）。
// 诚实边界：本校验器防「漏填」，不防「填假」（R1 残余风险仍在，不假装关掉）。
// 本模块是 P1-12 交付物（docs/pre-device/env-ready.schema.json + 校验入口）的规格内核。

/** 校验 schema 文件本身的结构（键清单形态）。返回错误数组。 */
export function checkSchemaShape(schema) {
  const errs = [];
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return ['schema 顶层必须是对象（键清单）'];
  }
  for (const [key, def] of Object.entries(schema)) {
    if (typeof def !== 'object' || def === null) {
      errs.push(`键 "${key}" 的定义必须是对象`);
      continue;
    }
    if (!def.type) errs.push(`键 "${key}" 缺 type`);
    if (typeof def.why !== 'string' || def.why.length === 0) errs.push(`键 "${key}" 缺非空 why（错误信息要能把解释带给人）`);
    if (def.enum !== undefined && !Array.isArray(def.enum)) errs.push(`键 "${key}" enum 必须是数组`);
    if (def.pattern !== undefined && typeof def.pattern !== 'string') errs.push(`键 "${key}" pattern 必须是字符串`);
  }
  return errs;
}

const ISOISH_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** 校验一份 env-ready 数据对象。返回错误数组（空=全绿放行）。 */
export function validateEnvReady(obj, schema) {
  const errs = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return ['env-ready 顶层必须是对象'];
  }
  for (const [key, def] of Object.entries(schema)) {
    if (!(key in obj)) {
      errs.push(`缺键 "${key}"——${def.why || '（schema 未给 why）'}`);
      continue;
    }
    const item = obj[key];
    // L2 三元组：{value, evidence, at}
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errs.push(`键 "${key}" 必须是 {value, evidence, at} 三元组对象（实测值=${JSON.stringify(item).slice(0, 40)}）`);
      continue;
    }
    if (!('value' in item)) {
      errs.push(`键 "${key}" 缺 value——${def.why || ''}`);
    } else {
      const t = typeof item.value;
      if (def.type === 'boolean' && t !== 'boolean') errs.push(`键 "${key}" value 须为 boolean，实测 ${t}`);
      if (def.type === 'string' && t !== 'string') errs.push(`键 "${key}" value 须为 string，实测 ${t}`);
      if (def.enum && !def.enum.includes(item.value)) errs.push(`键 "${key}" value ${JSON.stringify(item.value)} 不在枚举 ${JSON.stringify(def.enum)} 内——${def.why || ''}`);
      if (def.pattern && (t !== 'string' || !new RegExp(def.pattern).test(item.value))) {
        errs.push(`键 "${key}" value 不匹配 pattern ${def.pattern}——${def.why || ''}`);
      }
    }
    if (typeof item.evidence !== 'string' || item.evidence.trim().length === 0) {
      errs.push(`键 "${key}" 缺非空 evidence（贴原始输出而非结论，防绿灯幻觉）`);
    }
    if (typeof item.at !== 'string' || !ISOISH_RE.test(item.at)) {
      errs.push(`键 "${key}" 缺合法时间戳 at（YYYY-MM-DDTHH:mm…）`);
    }
  }
  // 多出的键：不报错但要求也有 evidence（防悄悄塞无证据项）
  for (const key of Object.keys(obj)) {
    if (!(key in schema)) {
      const item = obj[key];
      if (typeof item !== 'object' || item === null || typeof item.evidence !== 'string' || item.evidence.trim() === '') {
        errs.push(`schema 外多出的键 "${key}" 也必须带非空 evidence`);
      }
    }
  }
  return errs;
}
