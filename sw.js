/* Service Worker —— 让"添加到主屏幕"之后真的像应用，而不是一个书签。
 *
 * 两个实际好处：
 *   1. 断网时还能打开，看到上一次的简报（吃饭时信号差是常事）
 *   2. 有网时简报数据优先走网络，方便拿到当天最新一版
 *
 * 缓存策略分两类：
 *   - 静态资源：先给缓存的（秒开），同时后台拉新的；下次打开就是新版
 *   - 简报数据：网络优先，失败回退缓存
 *
 * 【缓存名由构建时注入】
 * 下面那行的版本号会被 tools/build_site.py 替换成静态资源的内容哈希。
 * 为什么必须这么做：如果缓存名固定，改了 app.js / style.css 但没改本文件，
 * 老用户会一直命中旧缓存，界面永远不更新 —— 而且没有任何报错可查。
 */

const CACHE = 'digest-52389473805a'; /* BUILD_VERSION */

// 外壳文件。注意路径都是相对的 —— 站点可能部署在子路径下
// （例如 GitHub Pages 的 /repo/），绝对路径会失效。
const SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // 某个外壳文件 404 不该让整个 SW 装不上
        console.warn('[sw] 预缓存部分失败：', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  const isData = url.pathname.includes('/data/digest/');

  if (isData) {
    // 网络优先：有网就拿最新的，没网回退到缓存
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((hit) => hit || new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )))
    );
    return;
  }

  // 静态资源：stale-while-revalidate（先给缓存，同时后台拉新的）。
  //
  // 原来是纯"缓存优先"：命中就 return，从不回源。配合固定的缓存名，
  // 结果是改了 app.js / style.css 之后老用户永远看不到新界面。
  // 现在即使缓存名没变，也会在后台把新版本拉回来，下次打开就生效。
  const cacheable = /\.(html|js|css|png|webmanifest)$/.test(url.pathname)
    || url.pathname.endsWith('/');

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then(async (resp) => {
        if (resp && resp.ok && cacheable) {
          const copy = resp.clone();
          const cache = await caches.open(CACHE);
          await cache.put(req, copy);
        }
        return resp;
      }).catch(() => hit);

      // 有缓存就先给，同时让 network 在后台跑完并写回缓存
      if (hit) {
        event.waitUntil(network.catch(() => {}));
        return hit;
      }
      return network;
    })
  );
});
