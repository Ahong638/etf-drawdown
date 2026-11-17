// Netlify Function: 盤中取「即時價」(證交所基本市況報導網站, 非官方介面)，取不到就改用「最新收盤價」(證交所 OpenAPI)
const MIS = { "00662": "662", "00670L": "670", "00631L": "631", "00675L": "675", "00685L": "685", "T00": "idx" };
const EX = ["tse_00662.tw", "tse_00670L.tw", "tse_00631L.tw", "tse_00675L.tw", "tse_00685L.tw", "tse_t00.tw"].join("|");
const IDS = ["662", "670", "631", "675", "685", "idx"];
const UA = "Mozilla/5.0";
const num = (v) => parseFloat(String(v).replace(/,/g, ""));
const fmt = (d) => {
  d = String(d).replace(/\D/g, "");
  if (d.length === 7) d = String(parseInt(d.slice(0, 3), 10) + 1911) + d.slice(3);
  return d.length === 8 ? d.slice(0, 4) + "/" + d.slice(4, 6) + "/" + d.slice(6) : "";
};
const getOpen = async (path) => {
  const r = await fetch("https://openapi.twse.com.tw/v1" + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
};

async function live(out) {
  const home = await fetch("https://mis.twse.com.tw/stock/index.jsp", { headers: { "User-Agent": UA } });
  const cookie = (home.headers.getSetCookie ? home.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");
  const url = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=" + encodeURIComponent(EX) + "&json=1&delay=0&_=" + Date.now();
  const r = await fetch(url, { headers: { Cookie: cookie, "User-Agent": UA, Referer: "https://mis.twse.com.tw/stock/index.jsp" } });
  const txt = await r.text();
  if (!r.ok) throw new Error("MIS http " + r.status + " " + txt.slice(0, 100));
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error("MIS non-JSON: " + txt.slice(0, 120)); }
  if (!(j.msgArray || []).length) throw new Error("MIS empty msgArray, rtcode=" + j.rtcode);
  for (const m of j.msgArray || []) {
    const id = MIS[String(m.c).toUpperCase()];
    let z = num(m.z), t = m.t;
    // 該秒沒有成交時 z 是 "-"，改用內層 trade 的最近一筆成交價
    if (!(z > 0) && m.trade && num(m.trade.z) > 0) { z = num(m.trade.z); t = m.trade.t || m.t; }
    if (id && z > 0) out[id] = { price: z, live: true, time: t };
  }
}

async function closing(out) {
  try {
    const rows = await getOpen("/exchangeReport/STOCK_DAY_ALL");
    for (const x of rows) {
      const id = MIS[String(x.Code).trim().toUpperCase()];
      const p = num(x.ClosingPrice);
      if (id && id !== "idx" && p > 0 && !out[id]) out[id] = { price: p, live: false, date: fmt(x.Date) };
    }
  } catch (e) {}
  if (!out.idx) {
    try {
      const h = await getOpen("/indicesReport/MI_5MINS_HIST");
      const dk = (r) => String(r.Date || r["日期"]);
      const last = h.slice().sort((a, b) => dk(a).localeCompare(dk(b))).pop();
      const key = Object.keys(last).find((k) => /Closing|收盤/.test(k));
      const p = num(last[key]);
      if (p > 0) out.idx = { price: p, live: false, date: fmt(dk(last)) };
    } catch (e) {}
  }
}

exports.handler = async (event) => {
  const out = {};
  let liveError = null;
  try { await live(out); } catch (e) { liveError = String((e && e.message) || e); }
  if (IDS.some((id) => !out[id])) await closing(out);
  if (event && event.queryStringParameters && event.queryStringParameters.debug) out._debug = { liveError, liveCount: IDS.filter((id) => out[id] && out[id].live).length };
  if (!Object.keys(out).length) return { statusCode: 502, body: JSON.stringify({ error: "fetch failed" }) };
  return { statusCode: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=20" }, body: JSON.stringify(out) };
};
