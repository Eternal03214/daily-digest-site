/* 每日素材简报 —— 手机优先前端
 * 无框架、无构建、无依赖。改完直接刷新即可。
 *
 * 反馈状态存在 localStorage：只有一台手机、一个人用，本地状态就是真实状态。
 * 云端每天生成候选池，这里根据本地状态决定呈现与排序。
 */

'use strict';

// 建好仓库后改这一行，用于「给明天关键词」按钮
const GITHUB_REPO = 'Eternal03214/daily-digest';

// 站点根目录下的相对路径。发布时由 tools/build_site.py 把数据拷到同级的
// data/digest/ 下，所以这里不能写成 ../data（那会把 config/ 也暴露出去）。
const DATA_BASE = 'data/digest/';
const STORE_KEY = 'digest.state.v1';

// ---------------------------------------------------------------- 状态

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = Object.assign(blank(), JSON.parse(raw));
      // 老版本的状态里没有 shown 字段，补上默认值
      if (!s.shown || typeof s.shown !== 'object') s.shown = {};
      return s;
    }
  } catch (e) { /* 损坏则重置 */ }
  return blank();
}

function blank() {
  return {
    version: 1,
    feedback: {},          // itemId -> {action, at, title, author, games}
    blockedSources: [],    // 换方向的 UP 主（由 feedback 推导）
    blockedGames: [],      // 换方向次数够多后自动屏蔽的游戏（由 feedback 推导）
    gameRejects: {},       // game -> 被换方向的次数（由 feedback 推导）
    blockedTopics: [],     // 保留字段
    shown: {},             // itemId -> {date, slot}  前端展示历史，用于跨时段去重
    prefs: { hideDone: true, compact: false },
  };
}

let state = loadState();
const save = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

// ---------------------------------------------------------------- 工具

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 1800);
}

function fmtPlay(n) {
  if (!n) return '';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function fmtDur(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} 分钟` : `${sec} 秒`;
}

// ---------------------------------------------------------------- 数据

let index = { entries: [] };
let current = { date: null, slot: null };

async function loadIndex() {
  const r = await fetch(DATA_BASE + 'index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('index.json 读取失败');
  index = await r.json();
  index.entries = index.entries || [];
  // 按日期倒序、同日内 noon 在前
  index.entries.sort((a, b) =>
    b.date.localeCompare(a.date) || a.slot.localeCompare(b.slot));
}

async function loadDigest(entry) {
  const r = await fetch(DATA_BASE + entry.file, { cache: 'no-cache' });
  if (!r.ok) throw new Error(entry.file + ' 读取失败');
  return r.json();
}

// ---------------------------------------------------------------- 渲染

function renderTabs() {
  const dates = [...new Set(index.entries.map((e) => e.date))].slice(0, 7);
  $('date-tabs').innerHTML = dates.map((d) => {
    const on = d === current.date ? ' on' : '';
    const label = d.slice(5).replace('-', '/');
    const today = new Date().toISOString().slice(0, 10);
    const txt = d === today ? '今天' : label;
    return `<button class="${on.trim()}" data-date="${d}">${txt}</button>`;
  }).join('');

  $('date-tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { current.date = b.dataset.date; pickSlot(); };
  });
}

function pickSlot() {
  const slots = index.entries.filter((e) => e.date === current.date);
  if (!slots.length) return;
  if (!slots.some((s) => s.slot === current.slot)) current.slot = slots[0].slot;

  $('slot-tabs').innerHTML = slots.map((s) => {
    const on = s.slot === current.slot ? ' on' : '';
    return `<button class="${on.trim()}" data-slot="${s.slot}">${esc(s.label)}</button>`;
  }).join('');

  $('slot-tabs').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { current.slot = b.dataset.slot; renderAll(); };
  });

  renderAll();
}

function cardHTML(it) {
  const fb = state.feedback[it.id];
  const done = fb ? ' done' : '';
  const isRule = it.enriched_by === 'rule';

  const badges = [
    `<span class="badge rank">${it.rank}</span>`,
    `<span class="badge slot-${esc(it.slot)}">${esc(it.slot)}</span>`,
    it.is_fresh === true
      ? '<span class="badge hot">● 热点</span>'
      : '<span class="badge evergreen">○ 常青</span>',
    // 「新发布 · 未验证」：来自按发布时间检索的路线，没有播放量可比。
    // 与其假装能自动判断质量，不如如实标出来让你自己决定。
    it.quality_verified === false
      ? '<span class="badge unverified">新发布 · 未验证</span>' : '',
    it.off_keyword ? '<span class="badge explore">探索</span>' : '',
    it.origin === 'manual' ? '<span class="badge explore">你投喂的</span>' : '',
    it.feasible && it.feasible !== '不确定'
      ? `<span class="badge feasible">${esc(it.feasible)}</span>` : '',
  ].filter(Boolean).join('');

  const meta = [
    it.author ? esc(it.author) : '',
    fmtPlay(it.stats && it.stats.play) ? '播放 ' + fmtPlay(it.stats.play) : '',
    fmtDur(it.duration_sec),
    (it.published_at || '').slice(0, 10),
  ].filter(Boolean).join(' · ');

  const summary = it.summary
    ? `<p class="summary">${esc(it.summary)}</p>`
    : '<p class="summary empty">（无摘要）</p>';

  // 「依据」和「建议」分开显示。
  // 混在一起的话，你没法判断哪句可以核对、哪句只是推测 ——
  // 而模型并没有看过视频，这个区分是它可信度的全部来源。
  const basis = it.basis
    ? `<div class="basis"><b>依据：</b>${esc(it.basis)}</div>`
    : '';

  const why = it.why
    ? `<div class="why${isRule ? ' rule' : ''}"><b>可以试试：</b>${esc(it.why)}</div>`
    : '';

  // 投喂时写的备注【不再显示】：它属于私人内容，发布产物已经把它剥掉了
  // （见 tools/build_site.py 的字段白名单）。留着这段代码只会是永远拿不到
  // 数据的死代码，反而让人以为备注会出现在页面上。

  const ruleNote = isRule
    ? '<div class="rule-note">规则模式生成，未做内容拆解。接入大模型后这里会给出具体的剪辑手法分析。</div>'
    : '';

  const actions = [
    ['useful', '👍 有用'], ['stale', '🔥 太老'],
    ['seen', '✅ 已看过'], ['redirect', '🙅 换方向'],
  ].map(([k, label]) =>
    `<button data-act="${k}" class="${fb && fb.action === k ? 'on' : ''}">${label}</button>`
  ).join('');

  return `
<article class="card${done}" data-id="${esc(it.id)}">
  <div class="card-top">${badges}</div>
  <h2>${esc(it.title)}</h2>
  ${ruleNote}${summary}${basis}${why}
  <div class="card-foot"><span>${meta}</span></div>
  <div class="fb">${actions}</div>
  <a class="open-btn" href="${esc(it.url)}" target="_blank" rel="noopener">打开原文 →</a>
</article>`;
}

// 同一个游戏被连续换方向多少次后自动屏蔽。
// 不设成 1 是因为点一次「换方向」多半是不喜欢这条，不代表不想要这个游戏。
const GAME_REJECT_LIMIT = 3;

// 判断一条内容是否应当完全屏蔽
function isBanned(it) {
  if (it.author && state.blockedSources.includes(it.author)) return true;
  const games = it.matched_games || [];
  if (games.some((g) => state.blockedGames.includes(g))) return true;
  return false;
}

/**
 * 给缺少条目标识的老反馈补上作者/游戏信息。
 *
 * 早期版本只存 action 和 title，没存 author/games。
 * 屏蔽状态是从反馈推导的，缺了这两个字段就推不出来 ——
 * 所以要尽量从当前简报里回填。
 *
 * 返回无法回填（条目已不在当前简报里）的条数，用于如实告知用户。
 */
function backfillFeedbackMeta() {
  let unresolved = 0;
  Object.entries(state.feedback).forEach(([id, fb]) => {
    if (!fb || fb.action !== 'redirect') return;
    const hasAuthor = !!fb.author;
    const hasGames = Array.isArray(fb.games) && fb.games.length > 0;
    if (hasAuthor && hasGames) return;
    const it = cardById[id];
    if (it) {
      if (!hasAuthor) fb.author = it.author || '';
      if (!hasGames) fb.games = it.matched_games || [];
    } else if (!hasAuthor && !hasGames) {
      unresolved++;
    }
  });
  return unresolved;
}

/**
 * 从反馈记录全量重算屏蔽状态。
 *
 * 【为什么必须"重算"而不是"增量改"】
 * 原来是在点按钮时对 blockedSources / gameRejects 做加减。撤销逻辑因此
 * 很难写对：一个游戏累计 3 次被屏蔽后，撤销一次计数降到 2，
 * 但屏蔽标记要等计数归零才解除 —— 于是"2 次的时候仍然被屏蔽"，
 * 而且界面上看不到任何解释。
 *
 * 改成每次操作后从 state.feedback 全量重算：真相只有一个来源，
 * 计数与标记不可能再对不上，撤销也天然正确。
 */
function recomputeBlocks() {
  const authors = new Set();
  const rejects = {};

  Object.entries(state.feedback).forEach(([id, fb]) => {
    if (!fb || fb.action !== 'redirect') return;
    const it = cardById[id];
    const author = fb.author || (it && it.author);
    const games = fb.games || (it && it.matched_games) || [];
    if (author) authors.add(author);
    games.forEach((g) => { rejects[g] = (rejects[g] || 0) + 1; });
  });

  state.blockedSources = [...authors];
  state.gameRejects = rejects;
  state.blockedGames = Object.entries(rejects)
    .filter(([, n]) => n >= GAME_REJECT_LIMIT)
    .map(([g]) => g);
}

/**
 * 手动解除屏蔽。
 *
 * 屏蔽是从反馈推导出来的，所以"解除"不能直接删标记 ——
 * 那样下次重算又会加回来。正确做法是把相关的 redirect 反馈改成中性动作，
 * 让推导结果自然变化。语义上也说得通：我并不是真的不想看这个方向。
 */
function unblockAuthor(author) {
  Object.values(state.feedback).forEach((fb) => {
    if (fb && fb.action === 'redirect' && fb.author === author) {
      fb.action = 'seen';
    }
  });
  recomputeBlocks();
}

function unblockGame(game) {
  Object.values(state.feedback).forEach((fb) => {
    if (fb && fb.action === 'redirect' && (fb.games || []).includes(game)) {
      fb.action = 'seen';
    }
  });
  recomputeBlocks();
}

function bindCards() {
  document.querySelectorAll('.card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('.fb button').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.dataset.act;
        const item = cardById[id];

        // 再点一次同一按钮 = 撤销
        if (state.feedback[id] && state.feedback[id].action === act) {
          delete state.feedback[id];
          recomputeBlocks();
          toast('已撤销');
        } else {
          const before = state.blockedGames.slice();
          state.feedback[id] = {
            action: act,
            at: Date.now(),
            title: item ? item.title : '',
            // 把判断依据一起存下来：以后即使没有原始条目也能重算屏蔽状态
            author: item ? item.author : '',
            games: (item && item.matched_games) || [],
          };
          recomputeBlocks();

          if (act === 'redirect') {
            const newly = state.blockedGames.filter((g) => !before.includes(g));
            toast(newly.length
              ? `已连续换掉「${newly.join('、')}」，暂时屏蔽（可在设置里解除）`
              : '已换方向，后续减少此类（可撤销）');
          } else {
            const msg = {
              useful: '已标记有用', stale: '已标记太老',
              seen: '已标记看过',
            }[act];
            toast(msg + '（再点一次可撤销）');
          }
        }
        save();
        setTimeout(renderAll, 380);
      };
    });
  });
}

let cardById = {};

/**
 * 这条内容是否已经在"别处"展示过了。
 *
 * 【为什么需要】
 * 服务端只把默认选中的 5 条写进去重状态（data/state/seen.json），
 * 而前端补位展示过什么它并不知道。实测晚间那 5 条全都出现在午间的
 * 备选池里 —— 中午多点几次反馈，晚上就会看到中午已经看过的内容。
 *
 * 所以展示历史必须在前端也记一份：补位出来的同样算"看过"。
 */
function shownElsewhere(itemId) {
  const rec = state.shown[itemId];
  if (!rec) return false;
  if (rec.date < current.date) return true;   // 更早的日期展示过
  // 同一天、另一个时段展示过（中午看过的，晚上不再出现）
  return rec.date === current.date && rec.slot !== current.slot;
}

/** 把展示历史裁剪到最近 30 天，避免 localStorage 无限增长。 */
function pruneShown() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cut = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  Object.keys(state.shown).forEach((id) => {
    if (!state.shown[id] || state.shown[id].date < cut) delete state.shown[id];
  });
}

/**
 * 判断一条内容是否允许出现在「热点」位置。
 *
 * 服务端已经做过一次归类（超期的热点会改判为参考），这里是备选补位时的
 * 第二道闸：备选池里可能还留着旧的官方 PV，不能因为它是"热点"类型
 * 就顶替掉"最近发生了什么"。时效性一律看服务端按发布时间算的 is_fresh，
 * 不看模型给的 freshness。
 */
function isHotSlotEligible(it) {
  if (it.slot !== '热点') return true;
  return it.is_fresh === true;
}

/**
 * 决定这一屏显示哪些卡片。
 *
 * 这是「云端出候选池、前端按本地状态挑」的落地：
 * 服务端给的 items 是它按通用规则排好的前几条，pool 是备选。
 * 你反馈掉一条，它就从活跃列表里移出，后面那条自动补上来 ——
 * 所以标记「太老」的结果是换一条新的，而不是把卡片变灰。
 */
function buildDisplay(d) {
  const target = d.target_count || d.count || 5;
  const all = [...(d.items || []), ...(d.pool || [])];

  const active = [];
  const done = [];
  const shownIds = new Set();

  for (const it of all) {
    if (shownIds.has(it.id) || isBanned(it)) continue;
    if (shownElsewhere(it.id)) continue;      // 另一个时段已经展示过
    if (!isHotSlotEligible(it)) continue;     // 过期的"热点"不进热点位
    shownIds.add(it.id);
    if (state.feedback[it.id]) done.push(it);
    else active.push(it);
  }

  const shown = active.slice(0, target);
  const activeIds = new Set(shown.map((i) => i.id));
  const doneFiltered = done.filter((i) => !activeIds.has(i.id));

  return { shown, done: doneFiltered, target,
           poolLeft: Math.max(0, active.length - shown.length) };
}

/**
 * 热搜信号区。
 *
 * 这些是 B站热搜里筛出来的、与你方向相关的词 —— 用途是选题参考：
 * 一个词上了热搜，说明这个方向近期有流量。
 * 服务端已经在 clean 阶段滤掉了体育/社会新闻那类无关热搜。
 */
function trendsHTML(trends) {
  if (!trends || !trends.length) return '';
  return `
<section class="trends">
  <h3>热搜信号 <span class="hint-inline">· 选题参考，点开是搜索结果</span></h3>
  <div class="chips">
    ${trends.map((t) => `
      <a class="chip" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
    `).join('')}
  </div>
</section>`;
}

let renderVersion = 0;
function renderAll() {
  const version = ++renderVersion;
  const entry = index.entries.find(
    (e) => e.date === current.date && e.slot === current.slot);
  if (!entry) return;

  loadDigest(entry).then((d) => {
    if (version !== renderVersion) return;
    cardById = {};
    [...(d.items || []), ...(d.pool || [])].forEach((it) => { cardById[it.id] = it; });

    const { shown, done, target, poolLeft } = buildDisplay(d);
    shown.forEach((it, i) => { it.rank = i + 1; });
    // 补位进来的卡片没有服务端给的名次，标成 ✓ 以示区别
    done.forEach((it) => { it.rank = '✓'; });

    const rules = d.enrich_mode === 'rule' ? ' · 规则模式' : '';
    const more = poolLeft > 0 ? ` · 备选还有 ${poolLeft} 条` : '';
    const tn = (d.trends || []).length;
    const tnote = tn ? ` · 热搜 ${tn}` : '';
    $('meta').textContent =
      `${d.date} · ${d.label} · ${shown.length}/${target} 条${rules}${more}${tnote}`;

    // 焦点槽位落空时明确说出来，而不是拿旧内容凑数。
    // "今天没有新动态"本身就是有效信息，比塞一条去年的 PV 有用得多。
    const missing = d.missing_focus || [];
    const noticeEl = $('notice');
    if (missing.length) {
      noticeEl.textContent =
        `本时段没有找到：${missing.join('、')}。` +
        (missing.includes('热点') ? '本次来源中未找到符合条件的新动态。' : '');
      noticeEl.classList.remove('hidden');
    } else {
      noticeEl.classList.add('hidden');
    }

    const feed = $('feed');
    // hideDone = true 表示"隐藏已处理的卡片"，所以要取反
    const showDone = !state.prefs.hideDone;
    feed.innerHTML =
      shown.map(cardHTML).join('') +
      (showDone ? done.map(cardHTML).join('') : '') +
      trendsHTML(d.trends);

    $('empty').classList.toggle('hidden',
      shown.length > 0 || (showDone && done.length > 0));
    bindCards();

    // 把这一屏展示过的记进历史。
    // 注意记的是【实际展示出来的】，包括从池子里补位上来的 ——
    // 服务端的 seen.json 只记了它自己选的那 5 条，管不到补位内容。
    if (current.date && current.slot) {
      shown.forEach((it) => {
        state.shown[it.id] = { date: current.date, slot: current.slot };
      });
      pruneShown();
      save();
    }
  }).catch((e) => {
    if (version !== renderVersion) return;
    $('feed').innerHTML = `<p class="hint">读取失败：${esc(e.message)}</p>`;
  });
}

// ---------------------------------------------------------------- 设置

function renderSettings() {
  const fbs = Object.values(state.feedback);
  const counts = { useful: 0, stale: 0, seen: 0, redirect: 0 };
  fbs.forEach((f) => { if (counts[f.action] != null) counts[f.action]++; });

  $('fb-stats').innerHTML = [
    ['有用', counts.useful], ['太老', counts.stale],
    ['看过', counts.seen], ['换方向', counts.redirect],
  ].map(([k, v]) => `<div><b>${v}</b>${k}</div>`).join('');

  // 展示屏蔽了哪些 UP 主和游戏，并提供【逐项解除】。
  // 原来只显示一个列表、没有解绑入口，等于屏蔽之后没有出路。
  const box = $('blocked-info');
  const rows = [];

  if (state.blockedSources.length) {
    rows.push('<div class="blocked-group"><span>已屏蔽 UP 主</span>');
    state.blockedSources.forEach((a) => {
      rows.push(`<button class="chip-x" data-unblock-author="${esc(a)}">${esc(a)} ✕</button>`);
    });
    rows.push('</div>');
  }
  if (state.blockedGames.length) {
    rows.push('<div class="blocked-group"><span>已屏蔽游戏</span>');
    state.blockedGames.forEach((g) => {
      rows.push(`<button class="chip-x" data-unblock-game="${esc(g)}">${esc(g)} ✕</button>`);
    });
    rows.push('</div>');
  }
  const pending = Object.entries(state.gameRejects)
    .filter(([g, n]) => n > 0 && n < GAME_REJECT_LIMIT && !state.blockedGames.includes(g));
  if (pending.length) {
    rows.push('<div class="blocked-group"><span>接近屏蔽</span>');
    pending.forEach(([g, n]) => {
      rows.push(`<span class="chip-plain">${esc(g)} ${n}/${GAME_REJECT_LIMIT}</span>`);
    });
    rows.push('</div>');
  }

  if (rows.length) {
    box.innerHTML = rows.join('');
    box.style.display = '';
    box.querySelectorAll('[data-unblock-author]').forEach((b) => {
      b.onclick = () => {
        unblockAuthor(b.dataset.unblockAuthor);
        save(); renderSettings(); renderAll();
        toast(`已解除对「${b.dataset.unblockAuthor}」的屏蔽`);
      };
    });
    box.querySelectorAll('[data-unblock-game]').forEach((b) => {
      b.onclick = () => {
        unblockGame(b.dataset.unblockGame);
        save(); renderSettings(); renderAll();
        toast(`已解除对「${b.dataset.unblockGame}」的屏蔽`);
      };
    });
  } else {
    box.style.display = 'none';
  }

  $('link-keyword').href = buildIssueURL();
}

function buildIssueURL() {
  const repo = GITHUB_REPO.includes('YOUR_NAME') ? '' : GITHUB_REPO;
  const title = encodeURIComponent('[关键词] ' + new Date().toISOString().slice(0, 10));
  const body = encodeURIComponent(
    '<!-- 每行一个关键词。游戏名用于抓取方向，技法词用于技法内容 -->\n' +
    '<!-- 含链接的行 = 投喂，链接后面的文字会作为那条视频的备注 -->\n' +
    '鸣潮 卡点\n' +
    '转场 教程\n' +
    'https://www.bilibili.com/video/BV1xx411c7mD 这个转场节奏值得学\n');
  const base = repo
    ? `https://github.com/${repo}/issues/new`
    : 'https://github.com/issues/new';
  return `${base}?title=${title}&body=${body}`;
}

function bindSettings() {
  const sheet = $('settings');
  $('btn-settings').onclick = () => { renderSettings(); sheet.classList.remove('hidden'); };
  $('btn-close-settings').onclick = () => sheet.classList.add('hidden');
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.add('hidden'); };

  $('opt-hide-done').checked = state.prefs.hideDone;
  $('opt-compact').checked = state.prefs.compact;
  document.body.classList.toggle('compact', state.prefs.compact);

  $('opt-hide-done').onchange = (e) => {
    state.prefs.hideDone = e.target.checked; save(); renderAll();
  };
  $('opt-compact').onchange = (e) => {
    state.prefs.compact = e.target.checked; save();
    document.body.classList.toggle('compact', e.target.checked);
  };

  $('btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `digest-feedback-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast('已导出');
  };

  // 有导出就必须有导入 —— 换手机时只导出是搬不回去的
  const importer = $('file-import');
  $('btn-import').onclick = () => importer.click();
  importer.onchange = () => {
    const file = importer.files && importer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(reader.result);
        if (!incoming || typeof incoming !== 'object' || !incoming.feedback) {
          throw new Error('不是本应用导出的反馈文件');
        }
        const merge = confirm(
          `文件里有 ${Object.keys(incoming.feedback).length} 条反馈。\n\n` +
          `确定 = 合并（保留现有，补上文件里的）\n` +
          `取消 = 覆盖（用文件完全替换现有）`);
        if (merge) {
          // 只合并【反馈记录】和展示历史。
          // 绝不能合并 blockedSources / blockedGames / gameRejects ——
          // 它们是推导结果，直接合并会出现"本地记着有用、导入文件里带着
          // 旧的换方向屏蔽"这种互相矛盾的状态，而且再也推不回来。
          state.feedback = Object.assign({}, incoming.feedback, state.feedback);
          state.shown = Object.assign({}, incoming.shown, state.shown);
        } else {
          // 覆盖模式下也保留本机偏好，避免导入顺手把界面设置重置了
          const prefs = state.prefs;
          state = Object.assign(blank(), incoming);
          state.prefs = Object.assign(blank().prefs, prefs);
        }

        // 统一重算，保证屏蔽状态与反馈记录一致
        const unresolved = backfillFeedbackMeta();
        recomputeBlocks();
        save();
        $('opt-hide-done').checked = state.prefs.hideDone;
        $('opt-compact').checked = state.prefs.compact;
        document.body.classList.toggle('compact', state.prefs.compact);
        renderSettings();
        renderAll();
        const n = Object.keys(state.feedback).length;
        toast(unresolved
          ? `已导入 ${n} 条反馈；${unresolved} 条缺少条目信息，未计入屏蔽`
          : `已导入 ${n} 条反馈`);
      } catch (err) {
        toast('导入失败：' + err.message);
      }
      importer.value = '';
    };
    reader.readAsText(file);
  };

  $('btn-clear').onclick = () => {
    if (!confirm('确定清空全部反馈？此操作不可撤销。')) return;
    state = blank();
    save();
    $('opt-hide-done').checked = state.prefs.hideDone;
    renderSettings();
    renderAll();
    toast('已清空');
  };

  $('ver').textContent = 'v0.3 · 本地反馈 · 无云同步';
}

// ---------------------------------------------------------------- 启动

// 注册 Service Worker：断网时也能打开、看到上一次的简报。
// 只在 https 或 localhost 下可用，http 局域网预览时会静默失败，属预期行为。
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
      && location.hostname !== '127.0.0.1') {
    return;
  }
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // 有新版本就装上新版本，方便以后改了前端直接生效
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[sw] 有新版本，下次打开生效');
        }
      });
    });
  }).catch((e) => {
    console.warn('[sw] 注册失败：', e && e.message);
  });
}

// 在 Node 里跑测试时没有 document，跳过初始化。
// 这样 buildDisplay 这类纯逻辑可以被真正测到，而不是只做语法检查。
if (typeof document !== 'undefined') {
  (async function init() {
    bindSettings();
    registerSW();
    try {
      await loadIndex();
    } catch (e) {
      $('feed').innerHTML =
        `<p class="hint">还没有生成过简报。<br>先在本机运行流水线，或等定时任务执行。</p>`;
      return;
    }
    if (!index.entries.length) {
      $('empty').classList.remove('hidden');
      return;
    }
    current.date = index.entries[0].date;
    current.slot = index.entries[0].slot;
    renderTabs();
    pickSlot();
  })();
}

// 供 tests/test_frontend.mjs 使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildDisplay,
    blank,
    isBanned,
    GAME_REJECT_LIMIT,
    recomputeBlocks,
    unblockAuthor,
    unblockGame,
    backfillFeedbackMeta,
    isHotSlotEligible,
    setState: (s) => { state = s; },
    getState: () => state,
    setCurrent: (c) => { current = c; },
    setCardById: (m) => { cardById = m; },
  };
}
