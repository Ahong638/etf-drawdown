// Netlify Function: 從證交所 OpenAPI 取得「最新收盤價」（官方開放資料，收盤後更新）
const MAP = { "00662": "662", "00670L": "670", "00631L": "631", "00675L": "675", "00685L": "685" };
const num = (v) => parseFloat(String(v).replace(/,/g, ""));
// 民國 YYYMMDD 或西元 YYYYMMDD → YYYY/MM/DD
const fmt = (d) => {
  d = String(d).replace(/\D/g, "");
  if (d.length === 7) d = String(parseInt(d.slice(0, 3), 10) + 1911) + d.slice(3);
  return d.length === 8 ? d.slice(0, 4) + "/" + d.slice(4, 6) + "/" + d.slice(6) : "";
};
const get = async (path) => {
  const r = await fetch("https://openapi.twse.com.tw/v1" + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
};

exports.handler = async () => {
  const out = {};
  try {
    const rows = await get("/exchangeReport/STOCK_DAY_ALL");
    for (const x of rows) {
      const id = MAP[String(x.Code).trim().toUpperCase()];
      const p = num(x.ClosingPrice);
      if (id && p > 0) out[id] = { price: p, date: fmt(x.Date) };
    }
  } catch (e) {}
  try {
    const h = await get("/indicesReport/MI_5MINS_HIST");
    const last = h.slice().sort((a, b) => String(a.Date || a["日期"]).localeCompare(String(b.Date || b["日期"]))).pop();
    const key = Object.keys(last).find((k) => /Closing|收盤/.test(k));
    const p = num(last[key]);
    if (p > 0) out.idx = { price: p, date: fmt(last.Date || last["日期"]) };
  } catch (e) {}
  if (!Object.keys(out).length) return { statusCode: 502, body: JSON.stringify({ error: "fetch failed" }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" }, body: JSON.stringify(out) };
};
