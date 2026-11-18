import type { Eligibility, WorkplaceType } from './schema'

/**
 * Rules-only location eligibility. Runs in the Action, so no LLM: anything these rules
 * can't place stays `unknown` and is resolved locally after sync.
 *
 * Order of evidence: structured fields from the ATS, then the location text, then
 * strong phrases in the description (only when the location left the country open).
 */

export interface LocationInput {
  /** Raw location text. May hold several locations separated by ";" or "|". */
  text: string
  /** Structured country from the ATS: ISO code ("CA", "US") or a name ("Canada"). */
  country?: string | null
  /** Structured workplace type for this location, if the ATS has one. */
  workplaceType?: WorkplaceType | null
}

export interface EligibilityInput {
  /** Primary location first. */
  locations: LocationInput[]
  /** Job-level structured workplace type, used when a location says nothing. */
  workplaceType?: WorkplaceType | null
  descriptionText?: string
}

export interface EligibilityResult {
  eligibility: Eligibility
  /** 'CA', 'US', another place name, or null. */
  country: string | null
  workplaceType: WorkplaceType | null
}

type Place = { kind: 'CA' } | { kind: 'US' } | { kind: 'REGION' } | { kind: 'OTHER'; name: string }

interface Part {
  place: Place | null
  mode: WorkplaceType | null
  /** The text was only a mode word ("Remote", "Hybrid"), or empty. */
  bareMode: boolean
}

const BARE_MODE = /^(fully |100% )?(remote|hybrid|on[- ]?site|in[- ]office)?[\s()-]*$/i

// ---------- Patterns ----------

const CA_PROVINCES =
  /\b(ontario|qu[eé]bec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|yukon|northwest territories|nunavut)\b/i
const CA_CITIES =
  /\b(toronto|vancouver|montr[eé]al|ottawa|calgary|edmonton|waterloo|kitchener|winnipeg|halifax|mississauga|markham|burnaby|gatineau|saskatoon|regina|fredericton|moncton|guelph|oakville|laval|victoria,\s*bc)\b/i
const CA_COUNTRY = /\bcanad(a|ian)\b/i
const CA_CODE = /\bCAN\b/ // "KOHO (CAN)"; case-sensitive so the word "can" doesn't match

const US_COUNTRY_NAME = /\bunited states\b/i
const US_COUNTRY_CODE = /\bU\.S\.(A\.)?|\bUSA?\b/ // case-sensitive so the word "us" doesn't match
const US_STATES =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i
const US_CITIES =
  /\b(san francisco|new york|nyc|seattle|austin|boston|chicago|denver|los angeles|atlanta|miami|dallas|houston|portland|san diego|san jose|palo alto|mountain view|menlo park|bay area|silicon valley|philadelphia|pittsburgh|salt lake city|phoenix|minneapolis|detroit|raleigh|nashville)\b/i

// Regions that include Canada. Only count as Canada-eligible when the job is remote.
const REGION_INCL = /\b(north america|americas|worldwide|anywhere|global(ly)?)\b/i

const OTHER_PLACES =
  /\b(united kingdom|UK|england|scotland|london|ireland|dublin|germany|berlin|munich|france|paris|spain|madrid|barcelona|portugal|lisbon|italy|netherlands|amsterdam|luxembourg|ukraine|hungary|serbia|croatia|bulgaria|lithuania|latvia|iceland|belgium|switzerland|zurich|austria|vienna|poland|warsaw|romania|bucharest|sweden|stockholm|denmark|copenhagen|norway|finland|estonia|czech(ia| republic)?|prague|greece|turkey|israel|tel aviv|india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|singapore|japan|tokyo|south korea|korea|seoul|china|hong kong|taiwan|philippines|vietnam|indonesia|malaysia|thailand|australia|sydney|melbourne|new zealand|brazil|s[aã]o paulo|mexico|argentina|colombia|chile|peru|UAE|united arab emirates|dubai|saudi arabia|KSA|riyadh|qatar|pakistan|middle east|south africa|nigeria|kenya|egypt|europe|EMEA|APAC|LATAM|asia|EU)\b/i

// Two-letter region codes, which only count after a comma or inside parentheses
// ("Toronto, ON", "Remote (BC)", "San Francisco, CA").
const REGION_CODE = /(?:,\s*|\()([A-Z]{2,3})(?![A-Za-z])/g
const CA_PROVINCE_CODES = new Set('ON BC AB QC MB SK NS NB NL PE PEI YT NT NU'.split(' '))
const US_STATE_CODES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(
    ' ',
  ),
)
// Province and state codes that are also ISO country codes: NL is Newfoundland or the
// Netherlands, DE is Delaware or Germany, IN is Indiana or India, CA is California or Canada.
const ALSO_COUNTRY_CODES = new Set(
  'NL PE SK YT AL AR AZ CA CO DE GA ID IL IN KY LA MA MD ME MN MO MS MT NC NE PA SC SD TN VA'.split(
    ' ',
  ),
)

const MODE_REMOTE = /\bremote\b|\bwork from home\b|\bdistributed\b/i
const MODE_HYBRID = /\bhybrid\b/i
const MODE_ONSITE = /\bon[- ]?site\b|\bin[- ]office\b/i

// Strong description phrases. Only consulted when the location leaves the country open.
const DESC_CANADA_OK =
  /\b(remote|anywhere|based|located|reside|residing|live|living|work|working)\b[^.\n]{0,40}?\b(in|within|from|across)\s+(canada|north america)\b|\bcanada[- ]based\b|\b(candidates|applicants) (in|from) canada\b/i
const US = String.raw`(U\.S\.|US\b|USA\b|united states\b)`
const DESC_US_ONLY = [
  new RegExp(
    String.raw`\b(authori[sz]ed|eligible|legally (able|permitted)) to work in the ${US}`,
    'i',
  ),
  new RegExp(String.raw`\bmust (be located|be based|reside|live) in the ${US}`, 'i'),
  new RegExp(String.raw`\bremote within the ${US}`, 'i'),
  /\bunited states[- ]only\b/i,
  /\b(U\.S\.|USA?)[- ]only\b/, // case-sensitive so "contact us only" doesn't count
]

// ---------- Helpers ----------

function detectMode(text: string): WorkplaceType | null {
  if (MODE_HYBRID.test(text)) return 'hybrid'
  if (MODE_REMOTE.test(text)) return 'remote'
  if (MODE_ONSITE.test(text)) return 'onsite'
  return null
}

/** True if the text names something besides a work mode ("Remote", "Hybrid") and punctuation. */
function hasPlaceWords(text: string): boolean {
  const rest = text
    .replace(MODE_REMOTE, '')
    .replace(MODE_HYBRID, '')
    .replace(MODE_ONSITE, '')
    .replace(/[\s,()\-–—:/]+/g, '')
  return rest.length > 0
}

/**
 * Reads a trailing province/state code ("Toronto, ON"). Returns undefined when there's
 * no such code, and null when there is one but it can't be told apart from a country code.
 */
function placeFromRegionCode(text: string): Place | null | undefined {
  // The last code is usually the most specific one ("Austin, TX").
  for (const m of [...text.matchAll(REGION_CODE)].toReversed()) {
    const code = m[1]
    const isCa = CA_PROVINCE_CODES.has(code)
    if (!isCa && !US_STATE_CODES.has(code)) continue
    if (ALSO_COUNTRY_CODES.has(code)) {
      const before = text.slice(0, m.index)
      const foreign = OTHER_PLACES.exec(before)
      // "Amsterdam, NL" is the Netherlands, not Newfoundland.
      if (foreign) return { kind: 'OTHER', name: foreign[1] }
      // "Remote, DE": Delaware or Germany? Leave it for the LLM pass.
      if (!hasPlaceWords(before)) return null
    }
    return { kind: isCa ? 'CA' : 'US' }
  }
  return undefined
}

/** True if free text names Canada, a province, or a Canadian city (used by the HN miner). */
export function mentionsCanada(text: string): boolean {
  if (CA_COUNTRY.test(text) || CA_CODE.test(text) || CA_PROVINCES.test(text)) return true
  if (CA_CITIES.test(text)) return true
  return [...text.matchAll(REGION_CODE)].some(
    (m) => CA_PROVINCE_CODES.has(m[1]) && !ALSO_COUNTRY_CODES.has(m[1]),
  )
}

function detectPlace(text: string): Place | null {
  // 1. Country names and codes are the strongest signal.
  if (CA_COUNTRY.test(text) || CA_CODE.test(text)) return { kind: 'CA' }
  if (US_COUNTRY_NAME.test(text) || US_COUNTRY_CODE.test(text)) return { kind: 'US' }

  // 2. A province/state code beats a city name: "Vancouver, WA" is in Washington.
  const fromCode = placeFromRegionCode(text)
  if (fromCode !== undefined) return fromCode

  // 3. Province, state and city names.
  if (CA_PROVINCES.test(text) || CA_CITIES.test(text)) return { kind: 'CA' }
  if (US_STATES.test(text) || US_CITIES.test(text)) return { kind: 'US' }
  // A named place beats a broad word: "Remote, anywhere in Europe" is about Europe.
  const other = OTHER_PLACES.exec(text)
  if (other) return { kind: 'OTHER', name: other[1] }
  if (REGION_INCL.test(text)) return { kind: 'REGION' }
  return null
}

function placeFromStructured(country: string | null | undefined): Place | null {
  const c = country?.trim()
  if (!c) return null
  if (/^(CA|CAN|canada)$/i.test(c)) return { kind: 'CA' }
  if (/^(US|USA|united states( of america)?)$/i.test(c)) return { kind: 'US' }
  return { kind: 'OTHER', name: c }
}

function toParts(loc: LocationInput, jobMode: WorkplaceType | null): Part[] {
  const structuredPlace = placeFromStructured(loc.country)
  const wholeMode = detectMode(loc.text)
  const pieces = loc.text
    .split(/[;|]|\s\/\s/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (pieces.length === 0) {
    return structuredPlace || loc.workplaceType
      ? [{ place: structuredPlace, mode: loc.workplaceType ?? jobMode, bareMode: !structuredPlace }]
      : []
  }

  return pieces.map((piece) => ({
    bareMode: BARE_MODE.test(piece),
    // A structured country only describes the location when there's a single piece of text.
    place: detectPlace(piece) ?? (pieces.length === 1 ? structuredPlace : null),
    // Mode named in this piece, else anywhere in this location's text, else structured.
    mode: detectMode(piece) ?? wholeMode ?? loc.workplaceType ?? jobMode,
  }))
}

function bestCanadaEligibility(modes: (WorkplaceType | null)[]): Eligibility {
  if (modes.includes('remote')) return 'remote_canada_ok'
  if (modes.includes('hybrid')) return 'canada_hybrid'
  return 'canada_onsite'
}

function placeLabel(p: Place | null): string | null {
  if (!p) return null
  if (p.kind === 'OTHER') return p.name
  if (p.kind === 'REGION') return null
  return p.kind
}

// ---------- Main ----------

export function classifyEligibility(input: EligibilityInput): EligibilityResult {
  const jobMode = input.workplaceType ?? null
  const rawParts = input.locations.flatMap((l) => toParts(l, jobMode))
  // A bare "Remote" / "Hybrid" piece says nothing about where, so it doesn't keep the
  // other, placed pieces from deciding ("Remote; Turkey" is about Turkey).
  const placed = rawParts.filter((p) => p.place)
  const parts = placed.length > 0 ? rawParts.filter((p) => p.place || !p.bareMode) : rawParts

  // 1. Any location in Canada, or a remote job open to a region that includes Canada.
  const canadaParts = parts.filter(
    (p) => p.place?.kind === 'CA' || (p.place?.kind === 'REGION' && p.mode === 'remote'),
  )
  if (canadaParts.length > 0) {
    const modes = canadaParts.map((p) => p.mode)
    const eligibility = bestCanadaEligibility(modes)
    const workplaceType =
      eligibility === 'remote_canada_ok'
        ? 'remote'
        : eligibility === 'canada_hybrid'
          ? 'hybrid'
          : (modes.find(Boolean) ?? null)
    return { eligibility, country: 'CA', workplaceType }
  }

  const firstMode = parts.find((p) => p.mode)?.mode ?? jobMode
  const firstPlace = placeLabel(
    parts.find((p) => p.place && p.place.kind !== 'REGION')?.place ?? null,
  )
  const allPlaced = parts.length > 0 && parts.every((p) => p.place && p.place.kind !== 'REGION')

  // 2. Every location is placed and none is in Canada.
  if (allPlaced) {
    const remoteParts = parts.filter((p) => p.mode === 'remote')
    if (remoteParts.length === 0) {
      return { eligibility: 'non_canada_onsite', country: firstPlace, workplaceType: firstMode }
    }
    const usOnly = remoteParts.every((p) => p.place?.kind === 'US')
    return {
      eligibility: usOnly ? 'remote_us_only' : 'remote_non_canada',
      country: firstPlace,
      workplaceType: 'remote',
    }
  }

  // 3. Country left open by the location ("Remote", an unlisted city): look for strong phrases.
  const desc = input.descriptionText ?? ''
  const remoteOrOpen = firstMode === 'remote' || firstMode === null
  if (firstMode === 'remote' && DESC_CANADA_OK.test(desc)) {
    return { eligibility: 'remote_canada_ok', country: 'CA', workplaceType: 'remote' }
  }
  if (remoteOrOpen && !DESC_CANADA_OK.test(desc) && DESC_US_ONLY.some((re) => re.test(desc))) {
    return { eligibility: 'remote_us_only', country: 'US', workplaceType: firstMode }
  }

  return { eligibility: 'unknown', country: firstPlace, workplaceType: firstMode }
}
