import type { Variable } from "../types";

/**
 * Variables, as Postman resolves them: `{{name}}` looks in local → iteration data → environment →
 * collection → globals (the narrowest scope wins), `{{vault:name}}` reads the vault, and `{{$name}}`
 * is a dynamic variable (a fresh random value every time). Values may themselves contain variables
 * (resolved up to 10 levels deep).
 */

export type ScopeName = "local" | "data" | "environment" | "collection" | "globals" | "vault";
export type Scopes = Record<ScopeName, Record<string, string>>;

export const emptyScopes = (): Scopes => ({ local: {}, data: {}, environment: {}, collection: {}, globals: {}, vault: {} });

export const ORDER: ScopeName[] = ["local", "data", "environment", "collection", "globals"];

/** Enabled variables as a map, current value first (that's what requests use). */
export function toMap(vars: Variable[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars ?? []) if (v.enabled && v.key) out[v.key] = v.current ?? v.value;
  return out;
}

export function lookup(name: string, s: Scopes): { value: string; scope: ScopeName } | undefined {
  if (name.startsWith("vault:")) {
    const k = name.slice(6);
    return k in s.vault ? { value: s.vault[k], scope: "vault" } : undefined;
  }
  for (const scope of ORDER) if (Object.prototype.hasOwnProperty.call(s[scope], name)) return { value: s[scope][name], scope };
  return undefined;
}

const VAR = /\{\{([^{}]+?)\}\}/g;

export function resolve(text: string, s: Scopes, depth = 0): string {
  if (!text || !text.includes("{{") || depth > 10) return text;
  let changed = false;
  const out = text.replace(VAR, (m, raw: string) => {
    const name = raw.trim();
    if (name.startsWith("$")) {
      const fn = DYNAMIC[name.slice(1)];
      if (fn) {
        changed = true;
        return fn();
      }
      return m;
    }
    const hit = lookup(name, s);
    if (!hit) return m;
    changed = true;
    return hit.value;
  });
  return changed ? resolve(out, s, depth + 1) : out;
}

/** Names used in a string, and whether each resolves (for the red/green highlight). */
export function varsIn(text: string): string[] {
  return [...(text ?? "").matchAll(VAR)].map((m) => m[1].trim());
}

/* ------------------------------------------------------------------ dynamic variables */

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const int = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[int(0, 15)]).join("");
const alnum = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[int(0, 35)]).join("");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[int(0, 3)]}${hex(3)}-${hex(12)}`);

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Radia", "Tim", "Katherine", "Guido", "Frances", "James", "Hedy", "Anita", "Bjarne", "Sophie", "Priya", "Arjun", "Mei", "Kenji", "Amara", "Diego", "Lucia", "Omar", "Fatima", "Noah", "Emma", "Liam"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Perlman", "Berners-Lee", "Johnson", "van Rossum", "Allen", "Gosling", "Lamarr", "Borg", "Stroustrup", "Wilson", "Sharma", "Patel", "Chen", "Tanaka", "Okafor", "Garcia", "Rossi", "Haddad", "Khan", "Smith", "Brown", "Jones"];
const CITIES = ["Lisbon", "Kyoto", "Nairobi", "Toronto", "Oslo", "Austin", "Pune", "Bogotá", "Melbourne", "Seoul", "Kolkata", "Dublin", "Lagos", "Hanoi", "Porto"];
const COUNTRIES: [string, string][] = [["Portugal", "PT"], ["Japan", "JP"], ["Kenya", "KE"], ["Canada", "CA"], ["Norway", "NO"], ["United States", "US"], ["India", "IN"], ["Colombia", "CO"], ["Australia", "AU"], ["South Korea", "KR"], ["Ireland", "IE"], ["Nigeria", "NG"], ["Vietnam", "VN"], ["Germany", "DE"], ["Brazil", "BR"]];
const STREETS = ["Maple", "Oak", "Cedar", "Elm", "Willow", "Harbor", "Sunset", "River", "Hill", "Park", "Lake", "Station"];
const SUFFIX = ["Street", "Avenue", "Road", "Lane", "Way", "Drive", "Court"];
const COMPANIES = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Soylent", "Wonka", "Cyberdyne", "Tyrell"];
const COMPANY_SUFFIX = ["Inc", "LLC", "Group", "and Sons", "Ltd", "Labs"];
const ADJ = ["quick", "bright", "silent", "brave", "calm", "eager", "gentle", "happy", "lucky", "proud", "smart", "witty", "bold", "clever", "fancy"];
const NOUNS = ["river", "mountain", "pixel", "rocket", "garden", "signal", "matrix", "protocol", "bridge", "circuit", "sensor", "driver", "array", "panel", "bandwidth"];
const VERBS = ["parse", "compress", "index", "synthesize", "navigate", "calculate", "override", "transmit", "quantify", "program", "connect", "back up", "bypass", "hack", "reboot"];
const INGVERBS = VERBS.map((v) => (v.endsWith("e") ? v.slice(0, -1) : v) + "ing");
const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat".split(" ");
const DOMAIN_SUFFIX = ["com", "net", "org", "io", "dev", "info", "biz", "co"];
const JOB_AREAS = ["Security", "Infrastructure", "Data", "Marketing", "Mobility", "Research", "Brand", "Quality", "Operations", "Interactions"];
const JOB_DESC = ["Lead", "Senior", "Direct", "Corporate", "Dynamic", "Future", "Product", "National", "Regional", "Central", "Global", "Principal"];
const JOB_TYPES = ["Engineer", "Designer", "Manager", "Analyst", "Architect", "Consultant", "Developer", "Specialist", "Strategist", "Officer"];
const PRODUCTS = ["Chair", "Car", "Computer", "Keyboard", "Mouse", "Bike", "Ball", "Gloves", "Pants", "Shirt", "Table", "Shoes", "Hat", "Towels", "Soap"];
const MATERIALS = ["Steel", "Wooden", "Concrete", "Plastic", "Cotton", "Granite", "Rubber", "Metal", "Soft", "Fresh", "Frozen"];
const DEPARTMENTS = ["Books", "Movies", "Music", "Games", "Electronics", "Computers", "Home", "Garden", "Tools", "Grocery", "Health", "Beauty", "Toys", "Kids", "Sports"];
const CURRENCIES: [string, string, string][] = [["USD", "US Dollar", "$"], ["EUR", "Euro", "€"], ["GBP", "Pound Sterling", "£"], ["JPY", "Yen", "¥"], ["INR", "Indian Rupee", "₹"], ["BRL", "Brazilian Real", "R$"], ["KRW", "Won", "₩"]];
const MIME: [string, string][] = [["application/json", "json"], ["text/plain", "txt"], ["image/png", "png"], ["image/jpeg", "jpg"], ["application/pdf", "pdf"], ["text/csv", "csv"], ["audio/mpeg", "mp3"], ["video/mp4", "mp4"], ["application/zip", "zip"], ["text/html", "html"]];
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
];
const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "violet", "black", "white", "silver", "gold", "maroon", "olive", "navy"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DB_COLS = ["id", "title", "name", "email", "password", "token", "group", "category", "status", "comment", "createdAt", "updatedAt"];
const DB_TYPES = ["int", "varchar", "text", "date", "timestamp", "boolean", "bigint", "decimal", "json", "uuid"];
const ABBR = ["TCP", "HTTP", "SDD", "RAM", "GB", "CSS", "SSL", "AGP", "SQL", "FTP", "PCI", "AI", "ADP", "RSS", "XML", "EXE", "COM", "HDD", "THX", "SMTP", "SMS", "USB", "PNG", "JSON"];
const words = (n: number) => Array.from({ length: n }, () => pick(LOREM)).join(" ");
const sentence = () => cap(words(int(6, 12))) + ".";
const first = () => pick(FIRST);
const last = () => pick(LAST);
const userName = () => `${first()}.${last()}${int(1, 99)}`.toLowerCase().replace(/[^a-z0-9._]/g, "");
const domainWord = () => `${pick(ADJ)}-${pick(NOUNS)}`;
const date = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toUTCString();

/** Every dynamic variable, as Postman names them. */
export const DYNAMIC: Record<string, () => string> = {
  guid: uuid,
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  isoTimestamp: () => new Date().toISOString(),
  randomUUID: uuid,
  randomAlphaNumeric: () => alnum(1),
  randomBoolean: () => String(Math.random() < 0.5),
  randomInt: () => String(int(0, 1000)),
  randomColor: () => pick(COLORS),
  randomHexColor: () => `#${hex(6)}`,
  randomAbbreviation: () => pick(ABBR),
  randomIP: () => `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
  randomIPV6: () => Array.from({ length: 8 }, () => hex(4)).join(":"),
  randomMACAddress: () => Array.from({ length: 6 }, () => hex(2)).join(":"),
  randomPassword: () => alnum(15),
  randomLocale: () => pick(["en", "fr", "de", "es", "pt", "ja", "hi", "bn", "zh", "ko"]),
  randomUserAgent: () => pick(UAS),
  randomProtocol: () => pick(["http", "https"]),
  randomSemver: () => `${int(0, 9)}.${int(0, 20)}.${int(0, 30)}`,
  randomFirstName: first,
  randomLastName: last,
  randomFullName: () => `${first()} ${last()}`,
  randomNamePrefix: () => pick(["Mr.", "Ms.", "Mrs.", "Dr.", "Mx."]),
  randomNameSuffix: () => pick(["Jr.", "Sr.", "I", "II", "III", "MD", "PhD"]),
  randomJobArea: () => pick(JOB_AREAS),
  randomJobDescriptor: () => pick(JOB_DESC),
  randomJobTitle: () => `${pick(JOB_DESC)} ${pick(JOB_AREAS)} ${pick(JOB_TYPES)}`,
  randomJobType: () => pick(JOB_TYPES),
  randomPhoneNumber: () => `${int(200, 999)}-${int(200, 999)}-${int(1000, 9999)}`,
  randomPhoneNumberExt: () => `${int(1, 99)}-${int(200, 999)}-${int(200, 999)}-${int(1000, 9999)}`,
  randomCity: () => pick(CITIES),
  randomStreetName: () => `${pick(STREETS)} ${pick(SUFFIX)}`,
  randomStreetAddress: () => `${int(1, 9999)} ${pick(STREETS)} ${pick(SUFFIX)}`,
  randomCountry: () => pick(COUNTRIES)[0],
  randomCountryCode: () => pick(COUNTRIES)[1],
  randomLatitude: () => (Math.random() * 180 - 90).toFixed(4),
  randomLongitude: () => (Math.random() * 360 - 180).toFixed(4),
  randomAvatarImage: () => `https://i.pravatar.cc/150?u=${hex(8)}`,
  randomImageUrl: () => `https://picsum.photos/seed/${hex(6)}/640/480`,
  randomAbstractImage: () => `https://picsum.photos/seed/abstract${hex(4)}/640/480`,
  randomCatsImage: () => `https://cataas.com/cat?${hex(6)}`,
  randomImageDataUri: () => "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2264%22%20height%3D%2264%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20fill%3D%22%23eb4a10%22%2F%3E%3C%2Fsvg%3E",
  randomCompanyName: () => `${pick(COMPANIES)} ${pick(COMPANY_SUFFIX)}`,
  randomCompanySuffix: () => pick(COMPANY_SUFFIX),
  randomBs: () => `${pick(VERBS)} ${pick(ADJ)} ${pick(NOUNS)}s`,
  randomBsAdjective: () => pick(ADJ),
  randomBsBuzz: () => pick(VERBS),
  randomBsNoun: () => pick(NOUNS),
  randomCatchPhrase: () => `${cap(pick(ADJ))} ${pick(ADJ)} ${pick(NOUNS)}`,
  randomCatchPhraseAdjective: () => pick(ADJ),
  randomCatchPhraseDescriptor: () => pick(JOB_DESC),
  randomCatchPhraseNoun: () => pick(NOUNS),
  randomDatabaseColumn: () => pick(DB_COLS),
  randomDatabaseType: () => pick(DB_TYPES),
  randomDatabaseCollation: () => pick(["utf8_unicode_ci", "utf8_general_ci", "ascii_bin", "cp1250_general_ci"]),
  randomDatabaseEngine: () => pick(["InnoDB", "MyISAM", "MEMORY", "ARCHIVE", "CSV"]),
  randomDateFuture: () => date(int(1, 365)),
  randomDatePast: () => date(-int(1, 365)),
  randomDateRecent: () => date(-Math.random()),
  randomWeekday: () => pick(WEEKDAYS),
  randomMonth: () => pick(MONTHS),
  randomDomainName: () => `${domainWord()}.${pick(DOMAIN_SUFFIX)}`,
  randomDomainSuffix: () => pick(DOMAIN_SUFFIX),
  randomDomainWord: domainWord,
  randomEmail: () => `${userName()}@${pick(["gmail.com", "yahoo.com", "hotmail.com", "proton.me", "outlook.com"])}`,
  randomExampleEmail: () => `${userName()}@example.${pick(["com", "net", "org"])}`,
  randomUserName: userName,
  randomUrl: () => `https://${domainWord()}.${pick(DOMAIN_SUFFIX)}`,
  randomFileName: () => `${pick(NOUNS)}_${pick(ADJ)}.${pick(MIME)[1]}`,
  randomFileType: () => pick(["application", "audio", "image", "text", "video"]),
  randomFileExt: () => pick(MIME)[1],
  randomCommonFileName: () => `${pick(NOUNS)}.${pick(["pdf", "mp4", "png", "txt", "html"])}`,
  randomCommonFileType: () => pick(["audio", "image", "text", "video", "application"]),
  randomCommonFileExt: () => pick(["pdf", "mp4", "png", "txt", "html", "mp3", "jpg"]),
  randomFilePath: () => `/home/${pick(NOUNS)}/${pick(NOUNS)}.${pick(MIME)[1]}`,
  randomDirectoryPath: () => `/usr/${pick(NOUNS)}/${pick(NOUNS)}`,
  randomMimeType: () => pick(MIME)[0],
  randomPrice: () => (Math.random() * 1000).toFixed(2),
  randomProduct: () => pick(PRODUCTS),
  randomProductAdjective: () => cap(pick(ADJ)),
  randomProductMaterial: () => pick(MATERIALS),
  randomProductName: () => `${cap(pick(ADJ))} ${pick(MATERIALS)} ${pick(PRODUCTS)}`,
  randomDepartment: () => pick(DEPARTMENTS),
  randomNoun: () => pick(NOUNS),
  randomVerb: () => pick(VERBS),
  randomIngverb: () => pick(INGVERBS),
  randomAdjective: () => pick(ADJ),
  randomWord: () => pick([...NOUNS, ...ADJ, ...VERBS]),
  randomWords: () => Array.from({ length: int(2, 5) }, () => pick([...NOUNS, ...ADJ])).join(" "),
  randomPhrase: () => `If we ${pick(VERBS)} the ${pick(NOUNS)}, we can get to the ${pick(ADJ)} ${pick(NOUNS)} through the ${pick(ADJ)} ${pick(NOUNS)}!`,
  randomLoremWord: () => pick(LOREM),
  randomLoremWords: () => words(3),
  randomLoremSentence: sentence,
  randomLoremSentences: () => Array.from({ length: int(2, 6) }, sentence).join(" "),
  randomLoremParagraph: () => Array.from({ length: 3 }, sentence).join(" "),
  randomLoremParagraphs: () => Array.from({ length: 3 }, () => Array.from({ length: 3 }, sentence).join(" ")).join("\n \r"),
  randomLoremText: () => Array.from({ length: int(2, 5) }, sentence).join(" "),
  randomLoremSlug: () => words(3).replace(/ /g, "-"),
  randomLoremLines: () => Array.from({ length: int(1, 5) }, sentence).join("\n"),
  randomBankAccount: () => String(int(10000000, 99999999)),
  randomBankAccountName: () => pick(["Home Loan Account", "Checking Account", "Savings Account", "Money Market Account", "Credit Card Account"]),
  randomCreditCardMask: () => String(int(1000, 9999)),
  randomBankAccountBic: () => `${alnum(4).toUpperCase()}${pick(COUNTRIES)[1]}${alnum(2).toUpperCase()}`,
  randomBankAccountIban: () => `${pick(COUNTRIES)[1]}${int(10, 99)}${alnum(18).toUpperCase()}`,
  randomTransactionType: () => pick(["invoice", "payment", "deposit", "withdrawal"]),
  randomCurrencyCode: () => pick(CURRENCIES)[0],
  randomCurrencyName: () => pick(CURRENCIES)[1],
  randomCurrencySymbol: () => pick(CURRENCIES)[2],
  randomBitcoin: () => `1${alnum(33)}`,
};

export const DYNAMIC_NAMES = Object.keys(DYNAMIC);
