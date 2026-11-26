#!/usr/bin/env node
/**
 * 看看各个解析站「实际给的是什么清晰度」。
 *
 * 做法：拿解析站 302 出来的直链，只读文件头（Range 0-1MB），
 * 从 MP4 的 moov/trak/tkhd 里读出真实分辨率，再和 B 站 API 里
 * 该视频的源分辨率、以及匿名 playurl 允许的清晰度对照。
 *
 *   node tools/probe-quality.mjs [BV号]
 *
 * 只用 Node 内置能力，不依赖 ffprobe。
 */
const BV = process.argv[2] || 'BV1AM4y1M71p';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RESOLVERS = [
  ['后海线路 xuan25', `https://api.xuan25.com/bili-resolve/${BV}`],
  ['纯K线路 ckapi', `http://ckapi.sevenbrothers.cn/bili/api?id=${BV}`],
  ['星流线路 ouo', `https://bil.ouo.chat/player/?url=${BV}`],
  ['孤线路 91vrchat', `https://biliplayer.91vrchat.com/player/?url=${BV}`],
  ['暖夜线路 chiooone', `https://ktv.chiooone.com/player/?url=${BV}`],
  ['Bili2VRC squidtail', `https://api.squidtail.com/bili2vrc/parse/?bv=${BV}&p=1&format=mp4&otype=json`],
];

const QN_TEXT = {
  6: '240P', 16: '360P', 32: '480P', 64: '720P', 74: '720P60',
  80: '1080P', 112: '1080P60', 116: '1080P+', 120: '4K', 125: 'HDR', 126: '杜比', 127: '8K',
};

function boxes(buf) {
  const out = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    let size = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(i + 8));
    } else if (size === 0) {
      size = buf.length - i;
    }
    if (size < 8) break;
    out.push({ type, start: i, size });
    i += size;
  }
  return out;
}

function findBox(buf, path) {
  let scope = buf;
  for (const want of path) {
    const hit = boxes(scope).find((b) => b.type === want);
    if (!hit) return null;
    scope = scope.subarray(hit.start + 8, hit.start + hit.size);
  }
  return scope;
}

/** 从 tkhd 里读宽高（最后 8 字节是两个 16.16 定点数）。 */
function tkhdSize(tkhd) {
  if (!tkhd || tkhd.length < 84) return null;
  const width = tkhd.readUInt32BE(tkhd.length - 8) / 65536;
  const height = tkhd.readUInt32BE(tkhd.length - 4) / 65536;
  if (!width || !height) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

async function fetchHead(url, { range = 'bytes=0-1048575', redirect = 'follow' } = {}) {
  const res = await fetch(url, {
    redirect,
    headers: { 'user-agent': UA, range, accept: '*/*' },
    signal: AbortSignal.timeout(15000),
  });
  return res;
}

async function readResolution(url) {
  const res = await fetchHead(url);
  if (!res.ok && res.status !== 206) return { error: `HTTP ${res.status}` };
  const total = Number(res.headers.get('content-length') || 0);
  const buf = Buffer.from(await res.arrayBuffer());
  // moov 可能不在第一个 1MB 里（faststart 通常在），找不到就多读一小段尾巴是不划算的，直接报告。
  const tkhd = findBox(buf, ['moov', 'trak', 'tkhd']);
  const size = tkhdSize(tkhd);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    bytes: buf.length,
    total,
    ...(size ? size : { error: '前 1MB 里没找到 moov/tkhd（可能不是 faststart）' }),
  };
}

async function biliApi(bvid) {
  const view = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) },
  ).then((r) => r.json());
  const data = view?.data || {};
  return {
    code: view?.code,
    title: data.title,
    dim: data.dimension,
    pages: data.pages?.length,
    cid: data.pages?.[0]?.cid,
  };
}

/** 匿名 playurl：分别看 html5（大多数解析站用的）和 DASH 允许哪些清晰度。 */
async function playurl(bvid, cid, { qn = 80, platform = 'html5', fnval } = {}) {
  const u = new URL('https://api.bilibili.com/x/player/playurl');
  u.searchParams.set('bvid', bvid);
  u.searchParams.set('cid', cid);
  u.searchParams.set('qn', String(qn));
  if (platform) u.searchParams.set('platform', platform);
  u.searchParams.set('high_quality', '1');
  if (fnval) u.searchParams.set('fnval', String(fnval));
  const json = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  const d = json?.data || {};
  const accepted = d.accept_quality || [];
  const dashQualities = (d.dash?.video || []).map((v) => v.id);
  return {
    code: json?.code,
    quality: d.quality,
    qualityText: QN_TEXT[d.quality] || String(d.quality ?? ''),
    accept: accepted.map((q) => `${q}(${QN_TEXT[q] || q})`).join(' '),
    dash: dashQualities.length ? dashQualities.map((q) => `${q}(${QN_TEXT[q] || q})`).join(' ') : '',
    host: d.durl?.[0]?.url ? new URL(d.durl[0].url).host : '',
  };
}

const info = await biliApi(BV);
console.log(`视频：${BV}`);
console.log(`标题：${info.title}`);
console.log(`源分辨率（B 站记录的 dimension）：${info.dim?.width}×${info.dim?.height}  分P数：${info.pages}`);
console.log('');

if (info.cid) {
  const html5 = await playurl(BV, info.cid, { qn: 80, platform: 'html5', fnval: 0 });
  console.log(`匿名 html5 请求 qn=80：拿到 ${html5.qualityText}(${html5.quality})，允许的清晰度：${html5.accept || '(空)'}`);
  const dash = await playurl(BV, info.cid, { qn: 120, platform: '', fnval: 4048 });
  console.log(`匿名 DASH 请求 qn=120：拿到 ${dash.qualityText}(${dash.quality})，DASH 里有的：${dash.dash || '(无)'}`);
  console.log('');
}

for (const [name, url] of RESOLVERS) {
  try {
    const res = await fetchHead(url, { range: 'bytes=0-0', redirect: 'manual' });

    if (res.status === 200 && (res.headers.get('content-type') || '').includes('json')) {
      const body = await res.json().catch(() => null);
      const q = body?.quality;
      console.log(`${name}: JSON 接口，quality=${q}(${QN_TEXT[q] || q})，accept_quality=${JSON.stringify(body?.accept_quality)}`);
      if (body?.url) {
        const r = await readResolution(body.url);
        console.log(`   → ${new URL(body.url).host} ${r.width ? `${r.width}×${r.height}` : r.error}`);
      }
      continue;
    }

    const location = res.headers.get('location');
    if (!location) {
      console.log(`${name}: 没有 302（HTTP ${res.status}）`);
      continue;
    }
    const r = await readResolution(location);
    const host = new URL(location).host;
    console.log(
      `${name}: ${host} → ${r.width ? `${r.width}×${r.height}` : r.error}` +
        (r.total ? `（文件 ${(r.total / 1024 / 1024).toFixed(1)} MB）` : ''),
    );
  } catch (err) {
    console.log(`${name}: 失败 ${err.message}`);
  }
}
