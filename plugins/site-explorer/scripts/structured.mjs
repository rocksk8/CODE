// Structured data (JSON-LD) checks: not just "is there any", but "does each item have what search engines require for its type".
// Rules follow the properties Google's rich-result documentation lists as required / recommended, kept deliberately short.
import { _t } from './i18n.mjs';
const NONEMPTY = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
export const hasVal = NONEMPTY;

const LOCAL = /^(LocalBusiness|Restaurant|Store|CafeOrCoffeeShop|BarOrPub|Bakery|Hotel|Dentist|Physician|MedicalClinic|AutoRepair|HomeAndConstructionBusiness|Plumber|Electrician|RealEstateAgent|LegalService|FinancialService|BeautySalon|HairSalon|HealthClub|TravelAgency|ProfessionalService|ShoppingCenter|LodgingBusiness|FoodEstablishment)$/;
const RULES = {
  Organization: { req: ['name'], rec: ['url', 'logo', 'sameAs', 'contactPoint'] },
  LocalBusiness: { req: ['name', 'address'], rec: ['telephone', 'openingHoursSpecification', 'geo', 'image', 'url', 'priceRange'] },
  WebSite: { req: ['name', 'url'], rec: ['potentialAction'] },
  Article: { req: ['headline', 'datePublished', 'author'], rec: ['image', 'dateModified', 'publisher'] },
  Product: { req: ['name'], anyOf: [['offers', 'review', 'aggregateRating']], rec: ['image', 'description', 'sku', 'brand'] },
  FAQPage: { req: ['mainEntity'], rec: [] },
  QAPage: { req: ['mainEntity'], rec: [] },
  BreadcrumbList: { req: ['itemListElement'], rec: [] },
  Event: { req: ['name', 'startDate', 'location'], rec: ['description', 'image', 'endDate', 'offers', 'eventStatus'] },
  Recipe: { req: ['name', 'image'], rec: ['author', 'datePublished', 'recipeIngredient', 'recipeInstructions'] },
  VideoObject: { req: ['name', 'thumbnailUrl', 'uploadDate'], rec: ['description', 'contentUrl'] },
  JobPosting: { req: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'], rec: ['validThrough', 'baseSalary'] },
  Person: { req: ['name'], rec: ['url', 'image'] },
  Review: { req: ['itemReviewed', 'reviewRating', 'author'], rec: ['datePublished'] },
  Course: { req: ['name', 'description', 'provider'], rec: [] },
  HowTo: { req: ['name', 'step'], rec: ['image', 'totalTime'] },
  SoftwareApplication: { req: ['name'], anyOf: [['offers']], rec: ['aggregateRating', 'operatingSystem', 'applicationCategory'] },
};
const ARTICLE = /^(Article|NewsArticle|BlogPosting|TechArticle|Report|ScholarlyArticle)$/;
const ruleFor = (type) => (RULES[type] ? type : LOCAL.test(type) ? 'LocalBusiness' : ARTICLE.test(type) ? 'Article' : null);

/** nodes: [{ types:[], props:[non-empty keys], context }] -> findings per node */
export function validateNodes(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.error || n.empty) continue;
    if (!n.types || !n.types.length) { if (!n.hasId && n.props && n.props.length > 1) out.push({ type: _t('(沒有 @type)'), untyped: true, missing: [], recommended: [] }); continue; } // {"@id": …} reference nodes are not items
    for (const t of n.types) {
      const key = ruleFor(t); if (!key) continue; const r = RULES[key]; const has = new Set(n.props || []);
      const missing = r.req.filter((p) => !has.has(p));
      for (const group of r.anyOf || []) if (!group.some((p) => has.has(p))) missing.push(group.join(_t(' 或 ')));
      const recommended = (r.rec || []).filter((p) => !has.has(p));
      if (missing.length || recommended.length) out.push({ type: t, missing, recommended });
    }
  }
  return out;
}
export const hasContextOk = (ctx) => /schema\.org/i.test(String(ctx || ''));
