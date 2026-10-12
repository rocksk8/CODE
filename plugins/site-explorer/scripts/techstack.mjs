#!/usr/bin/env node
// What is this site built with? CMS, framework, libraries, hosting/CDN, commerce — from evidence the crawl already has
// (scripts and stylesheets it loads, response headers, cookie names, generator tag, a few page globals and DOM markers).
// Every finding lists its evidence and a confidence; nothing is guessed from visual style. Rules are plain data below: add a line to teach it a new tool.
import { _t } from './i18n.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { isMain } from './util.mjs';
import { clean, BANNER } from './untrusted.mjs';

/** Browser-side: collects the few things that cannot be seen from files and headers. Strings and booleans only. */
export function extractTechInPage() {
  const w = window, out = { globals: {}, markers: [], generator: null, ngVersion: null, urls: [] };
  const val = (f) => { try { const v = f(); return v === undefined || v === null || v === false ? null : typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 30) : true; } catch { return null; } };
  const G = {
    jQuery: () => w.jQuery && (w.jQuery.fn?.jquery || true), React: () => w.React && (w.React.version || true), ReactDOM: () => w.ReactDOM && (w.ReactDOM.version || true),
    Vue: () => w.Vue && (w.Vue.version || true), angular: () => w.angular && (w.angular.version?.full || true), Backbone: () => !!w.Backbone, Ember: () => w.Ember && (w.Ember.VERSION || true),
    __NEXT_DATA__: () => !!w.__NEXT_DATA__, __NUXT__: () => !!w.__NUXT__, __remixContext: () => !!w.__remixContext, ___gatsby: () => !!w.___gatsby, Shopify: () => !!w.Shopify,
    wp: () => !!(w.wp && (w.wp.hooks || w.wp.i18n)), Drupal: () => !!w.Drupal, Webflow: () => !!w.Webflow, Wix: () => !!w.wixBiSession || !!w.wixPerformanceMeasurements, Squarespace: () => !!w.Squarespace,
    gsap: () => w.gsap && (w.gsap.version || true), THREE: () => w.THREE && (w.THREE.REVISION || true), bootstrap: () => w.bootstrap && (w.bootstrap.Tooltip?.VERSION || true),
    d3: () => w.d3 && (w.d3.version || true), L: () => w.L && w.L.version && (w.L.version || true), Chart: () => w.Chart && (w.Chart.version || true), moment: () => w.moment && (w.moment.version || true), _lodash: () => w._ && w._.VERSION && (w._.VERSION || true), mapboxgl: () => w.mapboxgl && (w.mapboxgl.version || true), Stripe: () => !!w.Stripe, grecaptcha: () => !!w.grecaptcha, hcaptcha: () => !!w.hcaptcha, Intercom: () => !!w.Intercom, htmx: () => !!w.htmx, Alpine: () => !!w.Alpine, Livewire: () => !!w.Livewire, Turbo: () => !!w.Turbo, Stimulus: () => !!w.Stimulus, Ghost: () => !!w.ghost,
  };
  for (const [k, f] of Object.entries(G)) { const v = val(f); if (v !== null) out.globals[k] = v; }
  const MARK = { '[class*="svelte-"]': 'svelte', '[q\\:container]': 'qwik', '#__next': 'next-root', '#__nuxt': 'nuxt-root', '#___gatsby': 'gatsby-root', '[data-reactroot]': 'react-root', '[data-v-app]': 'vue3-root', 'astro-island': 'astro-island', '[data-sveltekit-preload-data]': 'sveltekit', '[ng-version]': 'angular', '[data-wf-page]': 'webflow', '[data-framer-name]': 'framer', '.wp-block-group,[class*="wp-block-"]': 'wp-blocks', 'body.woocommerce': 'woocommerce', '[data-turbo]': 'turbo', '[x-data]': 'alpine', 'wire\\:id,[wire\\:id]': 'livewire', '[data-hx-get],[hx-get]': 'htmx' };
  for (const [sel, name] of Object.entries(MARK)) { try { if (document.querySelector(sel)) out.markers.push(name); } catch {} }
  out.ngVersion = document.querySelector('[ng-version]')?.getAttribute('ng-version')?.slice(0, 20) || null;
  out.generator = document.querySelector('meta[name=generator]')?.content?.slice(0, 100) || null;
  out.urls = [...new Set([...document.querySelectorAll('script[src],link[href],img[src],iframe[src]')].map((e) => e.src || e.href).filter((u) => /^https?:/.test(u)))].slice(0, 300);
  return out;
}

const V = (m) => (m && m[1] ? m[1] : null);
// [id, name, category, rules]  rules: { url: RegExp, header: [name, RegExp], cookie: RegExp, generator: RegExp, global: name, marker: name, version: (evidenceText) => string|null }
const RULES = [
  ['wordpress', 'WordPress', 'cms', { url: /\/wp-(content|includes)\//i, generator: /wordpress ?([\d.]+)?/i, header: ['x-pingback', /xmlrpc\.php/i], global: 'wp', marker: 'wp-blocks' }],
  ['woocommerce', 'WooCommerce', 'commerce', { url: /\/plugins\/woocommerce\//i, marker: 'woocommerce', cookie: /^woocommerce_/ }],
  ['shopify', 'Shopify', 'commerce', { url: /cdn\.shopify\.com|myshopify\.com/i, global: 'Shopify', header: ['x-shopify-stage', /./], cookie: /^_shopify_/ }],
  ['wix', 'Wix', 'cms', { url: /static\.(wixstatic|parastorage)\.com|wixstatic\.com/i, generator: /wix\.com/i, header: ['x-wix-request-id', /./], global: 'Wix' }],
  ['squarespace', 'Squarespace', 'cms', { url: /static1\.squarespace\.com|squarespace-cdn\.com/i, generator: /squarespace/i, global: 'Squarespace' }],
  ['webflow', 'Webflow', 'cms', { url: /webflow\.(com|io)|assets-global\.website-files\.com|uploads-ssl\.webflow\.com/i, generator: /webflow/i, marker: 'webflow', global: 'Webflow' }],
  ['framer', 'Framer', 'cms', { url: /framerusercontent\.com|framer\.com\/m\//i, generator: /framer/i, marker: 'framer' }],
  ['drupal', 'Drupal', 'cms', { generator: /drupal ?([\d.]+)?/i, header: ['x-drupal-cache', /./], global: 'Drupal', url: /\/sites\/(default|all)\/(files|modules|themes)\//i }],
  ['joomla', 'Joomla', 'cms', { generator: /joomla!? ?([\d.]+)?/i, url: /\/media\/jui\/|\/components\/com_/i }],
  ['ghost', 'Ghost', 'cms', { generator: /ghost ?([\d.]+)?/i, header: ['x-ghost-cache-status', /./], global: 'Ghost' }],
  ['hubspot-cms', 'HubSpot CMS', 'cms', { url: /hs-scripts\.com|hubspotusercontent|hs-sites\.com/i, generator: /hubspot/i }],
  ['typo3', 'TYPO3', 'cms', { generator: /typo3/i, url: /\/typo3(conf|temp)\//i }],
  ['magento', 'Magento', 'commerce', { url: /\/static\/version\d+\/frontend\/|\/media\/catalog\/|\/mage\/(requirejs|cookies|translate|utils)/i, cookie: /^(mage-|private_content_version)/ }],
  ['bigcommerce', 'BigCommerce', 'commerce', { url: /bigcommerce\.com|cdn11\.bigcommerce/i }],
  ['next', 'Next.js', 'framework', { global: '__NEXT_DATA__', marker: 'next-root', url: /\/_next\/static\//i, header: ['x-powered-by', /next\.js ?([\d.]+)?/i] }],
  ['nuxt', 'Nuxt', 'framework', { global: '__NUXT__', marker: 'nuxt-root', url: /\/_nuxt\//i }],
  ['gatsby', 'Gatsby', 'framework', { global: '___gatsby', marker: 'gatsby-root', generator: /gatsby ?([\d.]+)?/i }],
  ['remix', 'Remix', 'framework', { global: '__remixContext', url: /\/build\/_assets\//i }],
  ['astro', 'Astro', 'framework', { generator: /astro v?([\d.]+)?/i, marker: 'astro-island', url: /\/_astro\//i }],
  ['sveltekit', 'SvelteKit', 'framework', { marker: 'sveltekit', url: /\/_app\/immutable\//i }],
  ['angular', 'Angular', 'framework', { marker: 'angular', global: 'angular' }],
  ['vue', 'Vue.js', 'framework', { global: 'Vue', marker: 'vue3-root', url: /vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js|\/vue@/i }],
  ['react', 'React', 'framework', { global: 'React', marker: 'react-root', url: /(^|[\/@._-])react(-dom)?(\.production)?(\.min)?\.js|\/react@|\/react-dom@/i }],
  ['jquery', 'jQuery', 'library', { global: 'jQuery', url: /jquery([.-]\d[\d.]*)?(\.min)?\.js/i }],
  ['bootstrap', 'Bootstrap', 'library', { url: /bootstrap(\.bundle)?([.-]\d[\d.]*)?(\.min)?\.(js|css)|\/bootstrap@/i, global: 'bootstrap' }],
  ['tailwind', 'Tailwind CSS', 'library', { url: /tailwind(css)?(\.min)?\.css|cdn\.tailwindcss\.com/i }],
  ['alpine', 'Alpine.js', 'library', { global: 'Alpine', marker: 'alpine', url: /alpinejs/i }],
  ['htmx', 'htmx', 'library', { global: 'htmx', marker: 'htmx', url: /htmx(\.min)?\.js/i }],
  ['livewire', 'Laravel Livewire', 'framework', { global: 'Livewire', marker: 'livewire' }],
  ['turbo', 'Hotwire Turbo', 'library', { global: 'Turbo', marker: 'turbo' }],
  ['gsap', 'GSAP', 'animation', { global: 'gsap', url: /gsap(\.min)?\.js|\/gsap@|greensock/i }],
  ['three', 'three.js', 'animation', { global: 'THREE', url: /three(\.module)?(\.min)?\.js|\/three@/i }],
  ['lottie', 'Lottie', 'animation', { url: /lottie(\.min)?\.js|lottie-web|dotlottie/i }],
  ['swiper', 'Swiper', 'library', { url: /swiper(-bundle)?(\.min)?\.(js|css)|\/swiper@/i }],
  ['fontawesome', 'Font Awesome', 'library', { url: /font-?awesome|fontawesome|kit\.fontawesome\.com/i }],
  ['google-fonts', 'Google Fonts', 'fonts', { url: /fonts\.(googleapis|gstatic)\.com/i }],
  ['adobe-fonts', 'Adobe Fonts', 'fonts', { url: /use\.typekit\.net|fonts\.adobe\.com/i }],
  ['nginx', 'nginx', 'server', { header: ['server', /nginx\/?([\d.]+)?/i] }],
  ['apache', 'Apache', 'server', { header: ['server', /apache\/?([\d.]+)?/i] }],
  ['iis', 'Microsoft IIS', 'server', { header: ['server', /microsoft-iis\/?([\d.]+)?/i] }],
  ['litespeed', 'LiteSpeed', 'server', { header: ['server', /litespeed/i] }],
  ['caddy', 'Caddy', 'server', { header: ['server', /caddy/i] }],
  ['php', 'PHP', 'language', { header: ['x-powered-by', /php\/?([\d.]+)?/i], cookie: /^PHPSESSID$/ }],
  ['aspnet', 'ASP.NET', 'language', { header: ['x-powered-by', /asp\.net/i], cookie: /^(ASP\.NET_SessionId|\.AspNetCore)/ }],
  ['express', 'Express', 'framework', { header: ['x-powered-by', /express/i] }],
  ['laravel', 'Laravel', 'framework', { cookie: /^laravel_session$/ }],
  ['rails', 'Ruby on Rails', 'framework', { cookie: /^_[a-z0-9_]+_session$/, header: ['x-powered-by', /phusion passenger/i] }],
  ['cloudflare', 'Cloudflare', 'cdn', { header: ['cf-ray', /./], cookie: /^__cf(_bm|uid)$/ }],
  ['cloudfront', 'Amazon CloudFront', 'cdn', { header: ['x-amz-cf-id', /./], url: /\.cloudfront\.net/i }],
  ['fastly', 'Fastly', 'cdn', { header: ['x-served-by', /cache-/i] }],
  ['akamai', 'Akamai', 'cdn', { header: ['x-akamai-transformed', /./] }],
  ['vercel', 'Vercel', 'hosting', { header: ['x-vercel-id', /./] }],
  ['netlify', 'Netlify', 'hosting', { header: ['x-nf-request-id', /./], url: /\.netlify\.(app|com)/i }],
  ['github-pages', 'GitHub Pages', 'hosting', { header: ['x-github-request-id', /./] }],
  ['wpengine', 'WP Engine', 'hosting', { header: ['x-powered-by', /wp engine/i] }],
  ['svelte', 'Svelte', 'framework', { marker: 'svelte', url: /\/svelte(-[a-z]+)?@|\/svelte\.js/i }],
  ['solid', 'SolidJS', 'framework', { url: /\/solid-js(@|\/)/i }],
  ['preact', 'Preact', 'framework', { url: /preact(\.min|\.module)?\.js|\/preact@/i }],
  ['qwik', 'Qwik', 'framework', { url: /\/build\/q-[a-z0-9]+\.js/i, marker: 'qwik' }],
  ['docusaurus', 'Docusaurus', 'framework', { generator: /docusaurus v?([\d.]+)?/i }],
  ['vitepress', 'VitePress', 'framework', { generator: /vitepress v?([\d.]+)?/i }],
  ['hugo', 'Hugo', 'framework', { generator: /hugo ([\d.]+)?/i }],
  ['jekyll', 'Jekyll', 'framework', { generator: /jekyll v?([\d.]+)?/i }],
  ['eleventy', 'Eleventy', 'framework', { generator: /eleventy v?([\d.]+)?/i }],
  ['hexo', 'Hexo', 'framework', { generator: /hexo v?([\d.]+)?/i }],
  ['django', 'Django', 'framework', { cookie: /^csrftoken$/ }],
  ['spring', 'Spring / Java', 'framework', { cookie: /^JSESSIONID$/ }],
  ['nestjs', 'NestJS', 'framework', { header: ['x-powered-by', /nestjs/i] }],
  ['strapi', 'Strapi', 'cms', { header: ['x-powered-by', /strapi/i] }],
  ['craft', 'Craft CMS', 'cms', { header: ['x-powered-by', /craft cms/i], cookie: /^CraftSessionId$/ }],
  ['prestashop', 'PrestaShop', 'commerce', { generator: /prestashop/i, url: /\/themes\/[^/]+\/assets\/cache\//i, cookie: /^PrestaShop-/ }],
  ['opencart', 'OpenCart', 'commerce', { url: /\/catalog\/view\/(theme|javascript)\//i, cookie: /^OCSESSID$/ }],
  ['shopline', 'SHOPLINE', 'commerce', { url: /shoplineapp\.com|shopline\.(tw|app)|cdn\.shoplineapp/i }],
  ['cyberbiz', 'Cyberbiz', 'commerce', { url: /cyberbiz\.(co|io)/i }],
  ['91app', '91APP', 'commerce', { url: /91app\.(com|io)|nine-one\.com/i }],
  ['d3', 'D3.js', 'library', { global: 'd3', url: /\/d3(\.v\d+)?(\.min)?\.js|\/d3@/i }],
  ['chartjs', 'Chart.js', 'library', { global: 'Chart', url: /chart(\.umd)?(\.min)?\.js|\/chart\.js@/i }],
  ['leaflet', 'Leaflet', 'library', { global: 'L', url: /leaflet(\.min)?\.(js|css)|\/leaflet@/i }],
  ['mapbox', 'Mapbox GL', 'library', { global: 'mapboxgl', url: /api\.mapbox\.com|mapbox-gl/i }],
  ['google-maps', 'Google Maps', 'service', { url: /maps\.(googleapis|google)\.com\/maps\/api|maps\.gstatic\.com/i }],
  ['moment', 'Moment.js', 'library', { global: 'moment', url: /moment(\.min)?\.js|\/moment@/i }],
  ['lodash', 'Lodash', 'library', { global: '_lodash', url: /lodash(\.min)?\.js|\/lodash@/i }],
  ['axios', 'Axios', 'library', { url: /\/axios(\.min)?\.js|\/axios@/i }],
  ['slick', 'Slick', 'library', { url: /slick(\.min)?\.(js|css)|\/slick-carousel/i }],
  ['aos', 'AOS (Animate On Scroll)', 'animation', { url: /\/aos(\.min)?\.(js|css)|\/aos@/i }],
  ['anime', 'anime.js', 'animation', { url: /anime(\.min)?\.js|\/animejs/i }],
  ['framer-motion', 'Framer Motion', 'animation', { url: /framer-motion/i }],
  ['scrolltrigger', 'ScrollTrigger / ScrollSmoother', 'animation', { url: /ScrollTrigger|ScrollSmoother/i }],
  ['lenis', 'Lenis', 'animation', { url: /\/lenis(\.min)?\.js|\/lenis@|studio-freight\/lenis/i }],
  ['bulma', 'Bulma', 'library', { url: /bulma(\.min)?\.css|\/bulma@/i }],
  ['mui', 'Material UI', 'library', { url: /@mui\/|material-ui/i }],
  ['materialize', 'Materialize', 'library', { url: /materialize(\.min)?\.(js|css)/i }],
  ['semantic-ui', 'Semantic UI / Fomantic', 'library', { url: /semantic(\.min)?\.(js|css)|fomantic/i }],
  ['recaptcha', 'reCAPTCHA', 'service', { global: 'grecaptcha', url: /google\.com\/recaptcha|gstatic\.com\/recaptcha/i }],
  ['hcaptcha', 'hCaptcha', 'service', { global: 'hcaptcha', url: /hcaptcha\.com/i }],
  ['turnstile', 'Cloudflare Turnstile', 'service', { url: /challenges\.cloudflare\.com\/turnstile/i }],
  ['stripe', 'Stripe', 'service', { global: 'Stripe', url: /js\.stripe\.com/i }],
  ['paypal', 'PayPal', 'service', { url: /paypal(objects)?\.com\/(sdk|js)/i }],
  ['intercom', 'Intercom', 'service', { global: 'Intercom', url: /widget\.intercom\.io|js\.intercomcdn\.com/i }],
  ['zendesk', 'Zendesk', 'service', { url: /static\.zdassets\.com|zendesk\.com\/embeddable/i }],
  ['crisp', 'Crisp', 'service', { url: /client\.crisp\.chat/i }],
  ['tawk', 'Tawk.to', 'service', { url: /embed\.tawk\.to/i }],
  ['line-login', 'LINE (登入／官方帳號)', 'service', { url: /static\.line-scdn\.net|liff\.line\.me|line\.me\/(R|ti)\//i }],
  ['youtube', 'YouTube 嵌入', 'service', { url: /youtube(-nocookie)?\.com\/(embed|iframe_api)|ytimg\.com\/vi\//i }],
  ['vimeo', 'Vimeo 嵌入', 'service', { url: /player\.vimeo\.com/i }],
  ['sentry', 'Sentry', 'service', { url: /browser\.sentry-cdn\.com|sentry\.io\/api/i }],
  ['apache-tomcat', 'Apache Tomcat', 'server', { header: ['server', /apache-coyote|tomcat/i] }],
  ['gws', 'Google Frontend', 'cdn', { header: ['server', /google frontend|gws|esf/i] }],
  ['azure-fd', 'Azure Front Door', 'cdn', { header: ['x-azure-ref', /./] }],
  ['s3', 'Amazon S3', 'hosting', { header: ['server', /amazons3/i] }],
  ['heroku', 'Heroku', 'hosting', { header: ['via', /vegur/i] }],
  ['flyio', 'Fly.io', 'hosting', { header: ['fly-request-id', /./] }],
  ['render', 'Render', 'hosting', { header: ['x-render-origin-server', /./] }],
  ['kinsta', 'Kinsta', 'hosting', { header: ['x-kinsta-cache', /./] }],
  ['pantheon', 'Pantheon', 'hosting', { header: ['x-pantheon-styx-hostname', /./] }],
  ['cloudflare-pages', 'Cloudflare Pages / Workers', 'hosting', { url: /\.pages\.dev|\.workers\.dev/i }],
  ['varnish', 'Varnish', 'cdn', { header: ['via', /varnish/i] }],
  ['sucuri', 'Sucuri', 'cdn', { header: ['x-sucuri-id', /./] }],
  ['imperva', 'Imperva Incapsula', 'cdn', { header: ['x-iinfo', /./], cookie: /^incap_ses_/ }],

  // ---- round 9: more services, 3D / animation libraries, headless CMSs, CDNs, Taiwan payment gateways (URL signatures: weak on their own, stronger with a second hit) ----
  ['ecpay', 'ECPay 綠界', 'service', { url: /\.ecpay\.com\.tw/i }],
  ['newebpay', 'NewebPay 藍新', 'service', { url: /newebpay\.com/i }],
  ['tappay', 'TapPay', 'service', { url: /tappaysdk\.com/i }],
  ['drift', 'Drift', 'service', { url: /js\.driftt\.com/i }],
  ['freshchat', 'Freshchat', 'service', { url: /wchat\.freshchat\.com/i }],
  ['livechat', 'LiveChat', 'service', { url: /cdn\.livechatinc\.com/i }],
  ['olark', 'Olark', 'service', { url: /static\.olark\.com/i }],
  ['algolia', 'Algolia', 'service', { url: /algolia(net)?\.(com|net)/i }],
  ['disqus', 'Disqus', 'service', { url: /disqus\.com\/embed|\.disqus\.com/i }],
  ['mailchimp', 'Mailchimp', 'service', { url: /list-manage\.com|chimpstatic\.com/i }],
  ['klaviyo', 'Klaviyo', 'service', { url: /static\.klaviyo\.com/i }],
  ['typeform', 'Typeform', 'service', { url: /embed\.typeform\.com/i }],
  ['calendly', 'Calendly', 'service', { url: /assets\.calendly\.com/i }],
  ['optimizely', 'Optimizely', 'service', { url: /cdn\.optimizely\.com/i }],
  ['cookiebot', 'Cookiebot', 'service', { url: /consent\.cookiebot\.com/i }],
  ['onetrust', 'OneTrust', 'service', { url: /cdn\.cookielaw\.org|\.onetrust\.com/i }],
  ['trustpilot', 'Trustpilot', 'service', { url: /widget\.trustpilot\.com/i }],
  ['segment', 'Segment', 'service', { url: /cdn\.segment\.com/i }],
  ['mixpanel', 'Mixpanel', 'service', { url: /cdn\.mxpnl\.com/i }],
  ['amplitude', 'Amplitude', 'service', { url: /cdn\.amplitude\.com/i }],
  ['datadog-rum', 'Datadog RUM', 'service', { url: /datadoghq-browser-agent\.com/i }],
  ['new-relic', 'New Relic', 'service', { url: /js-agent\.newrelic\.com|nr-data\.net/i }],
  ['logrocket', 'LogRocket', 'service', { url: /cdn\.logr-ingest\.com|cdn\.lr-ingest\.io/i }],
  ['underscore', 'Underscore.js', 'library', { url: /underscore(-min)?\.js/i }],
  ['popper', 'Popper', 'library', { url: /popper(\.min)?\.js|@popperjs\/core/i }],
  ['select2', 'Select2', 'library', { url: /select2(\.min|\.full)?\.js/i }],
  ['datatables', 'DataTables', 'library', { url: /datatables(\.min)?\.js|jquery\.dataTables/i }],
  ['fancybox', 'Fancybox', 'library', { url: /fancybox/i }],
  ['owl-carousel', 'Owl Carousel', 'library', { url: /owl\.carousel/i }],
  ['masonry', 'Masonry', 'library', { url: /masonry(\.pkgd)?(\.min)?\.js/i }],
  ['dayjs', 'Day.js', 'library', { url: /dayjs(\.min)?\.js|\/dayjs@/i }],
  ['p5', 'p5.js', 'animation', { url: /\/p5(\.min)?\.js|\/p5@/i }],
  ['pixi', 'PixiJS', 'animation', { url: /pixi(\.min)?\.js|\/pixi\.js@/i }],
  ['babylon', 'Babylon.js', 'animation', { url: /cdn\.babylonjs\.com|babylon(\.max)?(\.min)?\.js/i }],
  ['playcanvas', 'PlayCanvas', 'animation', { url: /playcanvas/i }],
  ['aframe', 'A-Frame', 'animation', { url: /aframe(\.min)?\.js|\/aframe@/i }],
  ['spline', 'Spline', 'animation', { url: /prod\.spline\.design|@splinetool\//i }],
  ['rive', 'Rive', 'animation', { url: /@rive-app\/|rive\.app/i }],
  ['barba', 'Barba.js', 'animation', { url: /barba(\.min)?\.js|@barba\//i }],
  ['locomotive-scroll', 'Locomotive Scroll', 'animation', { url: /locomotive-scroll/i }],
  ['ember', 'Ember.js', 'framework', { url: /(^|[\/@._-])ember(\.prod)?(\.min)?\.js/i }],
  ['stimulus', 'Stimulus', 'framework', { url: /@hotwired\/stimulus|stimulus(\.umd)?(\.min)?\.js/i }],
  ['lit', 'Lit', 'framework', { url: /lit-html|lit-element|\/lit@|@lit\//i }],
  ['jsdelivr', 'jsDelivr', 'cdn', { url: /cdn\.jsdelivr\.net/i }],
  ['unpkg', 'unpkg', 'cdn', { url: /unpkg\.com/i }],
  ['cdnjs', 'cdnjs', 'cdn', { url: /cdnjs\.cloudflare\.com/i }],
  ['bunny', 'Bunny CDN', 'cdn', { url: /\.b-cdn\.net/i }],
  ['keycdn', 'KeyCDN', 'cdn', { url: /\.kxcdn\.com/i }],
  ['aws-amplify', 'AWS Amplify', 'hosting', { url: /\.amplifyapp\.com/i }],
  ['ecwid', 'Ecwid', 'commerce', { url: /app\.ecwid\.com/i }],
  ['sanity', 'Sanity', 'cms', { url: /cdn\.sanity\.io/i }],
  ['contentful', 'Contentful', 'cms', { url: /ctfassets\.net/i }],
  ['prismic', 'Prismic', 'cms', { url: /images\.prismic\.io|cdn\.prismic\.io/i }],
  ['storyblok', 'Storyblok', 'cms', { url: /a\.storyblok\.com/i }],
  ['datocms', 'DatoCMS', 'cms', { url: /datocms-assets\.com/i }],
  ['builder-io', 'Builder.io', 'cms', { url: /cdn\.builder\.io/i }],
  ['weebly', 'Weebly', 'cms', { url: /weebly\.com|editmysite\.com/i }],
  ['duda', 'Duda', 'cms', { url: /multiscreensite\.com/i }],
];

const CATEGORY = () => ({ cms: _t('內容管理系統／建站平台'), commerce: _t('電商'), framework: _t('前端／後端框架'), library: _t('函式庫'), animation: _t('動畫／3D'), fonts: _t('字型服務'), server: _t('網頁伺服器'), language: _t('程式語言'), cdn: _t('CDN'), hosting: _t('主機／部署平台'), service: _t('第三方服務（付款、客服、驗證碼、地圖…）') });
const ORDER = ['cms', 'commerce', 'framework', 'library', 'animation', 'fonts', 'service', 'language', 'server', 'cdn', 'hosting'];

/** User-supplied rules (--tech-rules rules.json): [{ "id": "acme-cms", "name": "Acme CMS", "category": "cms", "url": "acme-cdn\\.com", "header": ["x-acme", "."], "cookie": "^acme_", "generator": "Acme ([\\d.]+)" }].
 *  Strict validation; the patterns run in a sandboxed context with a time limit, so a bad pattern cannot hang the run. */
export function parseTechRules(text) {
  let j; try { j = JSON.parse(text); } catch { throw new Error(_t('技術規則檔不是有效的 JSON。')); }
  if (!Array.isArray(j) || !j.length || j.length > 100) throw new Error(_t('技術規則檔必須是 1 到 100 條規則的陣列。'));
  return j.map((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(_t`第 ${i + 1} 條規則必須是物件。`);
    if (!/^[a-z0-9-]{1,40}$/.test(String(r.id || ''))) throw new Error(_t`第 ${i + 1} 條規則的 id 只能用小寫英數字與連字號。`);
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 60) throw new Error(_t`第 ${i + 1} 條規則的 name 必須是 60 字以內的文字。`);
    if (!ORDER.includes(r.category)) throw new Error(_t`第 ${i + 1} 條規則的 category 必須是：${ORDER.join(', ')}。`);
    const pat = (v, what) => { if (v == null) return null; if (typeof v !== 'string' || !v || v.length > 200) throw new Error(_t`第 ${i + 1} 條規則的 ${what} 必須是 200 字以內的正規表示式字串。`); try { new RegExp(v, 'i'); } catch { throw new Error(_t`第 ${i + 1} 條規則的 ${what} 無法解析。`); } return v; };
    const header = r.header == null ? null : (Array.isArray(r.header) && r.header.length === 2 && typeof r.header[0] === 'string' && /^[a-z0-9-]{1,40}$/i.test(r.header[0]) ? [r.header[0].toLowerCase(), pat(r.header[1], 'header')] : (() => { throw new Error(_t`第 ${i + 1} 條規則的 header 必須是 ["標頭名稱", "正規表示式"]。`); })());
    const rule = { id: r.id, name: r.name.trim(), category: r.category, url: pat(r.url, 'url'), cookie: pat(r.cookie, 'cookie'), generator: pat(r.generator, 'generator'), header };
    if (!rule.url && !rule.cookie && !rule.generator && !rule.header) throw new Error(_t`第 ${i + 1} 條規則至少要有 url、header、cookie、generator 其中一個。`);
    return rule;
  });
}
const VM_CTX = vm.createContext({ p: '', inputs: [] }); // one sandbox for every rule and page (creating a context per call was the slow part)
const VM_SCRIPT = new vm.Script('(() => { const re = new RegExp(p, "i"); for (const x of inputs) { const m = re.exec(x); if (m) return [x, m[1] || null]; } return null; })()');
const vmFirst = (pattern, inputs) => { try { VM_CTX.p = pattern; VM_CTX.inputs = inputs.slice(0, 3000).map((x) => String(x).slice(0, 400)); const r = VM_SCRIPT.runInContext(VM_CTX, { timeout: 300 }); return r ? [String(r[0]), r[1] == null ? null : String(r[1])] : null; } catch { return null; } };

/** pages = page.json objects. `tech` = result of extractTechInPage per page may be stored as page.tech. Pure and offline. */
export function detectTech(pages, { extraRules = [] } = {}) {
  const live = (pages || []).filter((p) => p && (!p.status || p.status < 400));
  const found = new Map();
  const add = (rule, how, evidence, version) => {
    const [id, name, category] = rule; const f = found.get(id) || { id, name, category, evidence: [], versions: new Set(), hits: 0, strong: 0 };
    f.hits++; if (how !== 'url') f.strong++; if (evidence && f.evidence.length < 3 && !f.evidence.includes(evidence)) f.evidence.push(evidence); if (version && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,29}$/.test(String(version))) f.versions.add(String(version)); found.set(id, f);
  };
  for (const p of live) {
    const t = p.tech || {}; const urls = [...(p.editing?.scripts || []), ...(p.editing?.stylesheets || []), ...(t.urls || [])].map(String);
    const headers = p.seo?.http?.headers || {}; const cookies = (p.privacy?.cookies || []).map((c) => String(c.name || c));
    const generator = String(t.generator || p.meta?.generator || '');
    for (const rule of RULES) {
      const r = rule[3];
      if (r.url) { const u = urls.find((x) => r.url.test(x)); if (u) add(rule, 'url', u.replace(/^https?:\/\//, '').slice(0, 90), null); }
      if (r.generator) { const m = generator.match(r.generator); if (m) add(rule, 'generator', `generator: ${generator.slice(0, 60)}`, V(m)); }
      if (r.header) { const v = headers[r.header[0]]; if (v !== undefined) { const m = String(v).match(r.header[1]); if (m) add(rule, 'header', `${r.header[0]}: ${String(v).slice(0, 60)}`, V(m)); } }
      if (r.cookie) { const c = cookies.find((n) => r.cookie.test(n)); if (c) add(rule, 'cookie', `cookie: ${c.slice(0, 40)}`, null); }
      if (r.global && t.globals && t.globals[r.global] !== undefined) add(rule, 'global', `window.${r.global}`, typeof t.globals[r.global] === 'string' ? t.globals[r.global] : null);
      if (r.marker && (t.markers || []).includes(r.marker)) add(rule, 'marker', `DOM: ${r.marker}`, rule[0] === 'angular' ? t.ngVersion : null);
    }
    for (const r of extraRules) {
      const rule = [r.id, r.name, r.category];
      if (r.url) { const m = vmFirst(r.url, urls); if (m) add(rule, 'url', m[0].replace(/^https?:\/\//, '').slice(0, 90), m[1]); }
      if (r.generator && generator) { const m = vmFirst(r.generator, [generator]); if (m) add(rule, 'generator', `generator: ${generator.slice(0, 60)}`, m[1]); }
      if (r.header) { const v = headers[r.header[0]]; if (v !== undefined) { const m = vmFirst(r.header[1], [String(v)]); if (m) add(rule, 'header', `${r.header[0]}: ${String(v).slice(0, 60)}`, m[1]); } }
      if (r.cookie) { const m = vmFirst(r.cookie, cookies); if (m) add(rule, 'cookie', `cookie: ${m[0].slice(0, 40)}`, null); }
    }
    // a library version in a file name: jquery-3.7.1.min.js, bootstrap@5.3.2
    for (const u of urls) { const m = u.match(/(jquery|bootstrap|vue|react|react-dom|three|gsap|swiper)[-@.](\d+\.\d+(?:\.\d+)?)/i); if (m) { const f = found.get(m[1].toLowerCase() === 'react-dom' ? 'react' : m[1].toLowerCase()); if (f) f.versions.add(m[2]); } }
  }
  const items = [...found.values()].map((f) => ({ id: f.id, name: f.name, category: f.category, version: [...f.versions][0] || null, confidence: f.strong >= 1 && f.hits >= 2 ? 'high' : f.strong >= 1 || f.hits >= 2 ? 'medium' : 'low', evidence: f.evidence.map((e) => clean(e, 100)) }))
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  return { pagesChecked: live.length, items };
}

export function renderTechMd(r) {
  const C = CATEGORY(); const L = [BANNER, '', _t('# 這個網站用了什麼技術'), '', _t`依據：爬到的腳本與樣式表、回應標頭、Cookie 名稱、generator 標籤，以及頁面上的少數全域變數與 DOM 標記（共檢查 ${r.pagesChecked} 頁）。每一項都附證據；沒有證據的不會列。`, ''];
  if (!r.items.length) L.push(_t('（沒有辨識出已知的技術——可能是手寫的網站，或是這份規則還不認得它用的工具。）'), '');
  for (const cat of ORDER) {
    const list = r.items.filter((i) => i.category === cat); if (!list.length) continue;
    L.push(`## ${C[cat]}`, '', _t('| 技術 | 版本 | 把握度 | 證據 |'), '|---|---|---|---|');
    for (const i of list) L.push(`| ${clean(i.name, 40)} | ${i.version ? clean(i.version, 20) : ''} | ${i.confidence === 'high' ? _t('高') : i.confidence === 'medium' ? _t('中') : _t('低')} | ${i.evidence.map((e) => '`' + e.replace(/[`|]/g, '') + '`').join('<br>')} |`);
    L.push('');
  }
  L.push(_t('> 把握度「低」代表只在檔案網址裡看到一個線索；網站可以隱藏標頭、改名檔案，所以沒列出來不代表沒用。'), '');
  return L.join('\n').replace(/<br>/g, '; ');
}

if (isMain(import.meta.url)) {
  const i = process.argv.indexOf('--site'); const dir = i > 0 ? process.argv[i + 1] : null;
  if (!dir || !fs.existsSync(path.join(dir, 'site.json'))) { console.error(_t('用法：techstack.mjs --site <含 site.json 的爬取資料夾>')); process.exit(1); }
  const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8'));
  const pages = (site.pages || []).map((p) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'pages', p.slug, 'page.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
  const ri = process.argv.indexOf('--rules'); let extraRules = [];
  if (ri > 0) { try { extraRules = parseTechRules(fs.readFileSync(process.argv[ri + 1], 'utf8')); } catch (e) { console.error(String(e.code === 'ENOENT' ? _t('找不到技術規則檔') : e.message).split('\n')[0]); process.exit(1); } }
  const r = detectTech(pages, { extraRules });
  fs.writeFileSync(path.join(dir, 'techstack.json'), JSON.stringify(r, null, 2));
  fs.writeFileSync(path.join(dir, 'techstack.md'), renderTechMd(r) + '\n');
  console.log(_t`技術堆疊：${r.items.map((x) => x.name + (x.version ? ' ' + x.version : '')).slice(0, 12).join(_t('、')) || _t('（沒有辨識出）')} → ${path.join(dir, 'techstack.md')}`);
}
