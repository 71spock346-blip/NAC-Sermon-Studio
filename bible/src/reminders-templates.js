/*
 * Reminders: the greetings themselves.
 *
 * Several wordings for a birthday and for a wedding anniversary, in English
 * and in Afrikaans, each with placeholders filled in for the person: how they
 * are addressed, their age or years married, the minister's name. A wording
 * is offered only where it reads right — a child is not "Brother Liebenberg",
 * a milestone leads with the milestone — and the person can still change the
 * words before sending. The minister's own wordings sit beside these.
 */
import { salutation, coupleSalutation, coupleFirstNames, displayName, firstName, monthName } from './reminders-lib.js';

export function ageBand(age) {
  if (age === undefined) return 'adult';
  if (age < 13) return 'child';
  if (age < 20) return 'teen';
  if (age < 60) return 'adult';
  return 'senior';
}

/** A handful of well-known lines, kept short so a message stays a message and not a reading. */
const SCRIPTURES = {
  birthday: {
    en: [
      '"The Lord bless you and keep you." — Numbers 6:24',
      '"This is the day the Lord has made; let us rejoice and be glad in it." — Psalm 118:24',
      '"Teach us to number our days, that we may gain a heart of wisdom." — Psalm 90:12',
      '"The Lord is my shepherd; I shall not want." — Psalm 23:1',
      '"I know the plans I have for you, plans to give you hope and a future." — Jeremiah 29:11',
    ],
    af: [
      '"Die Here sal jou seën en jou beskerm." — Numeri 6:24',
      '"Dit is die dag wat die Here gemaak het; laat ons juig en bly wees daarin." — Psalm 118:24',
      '"Leer ons om ons dae so te gebruik dat ons wysheid bekom." — Psalm 90:12',
      '"Die Here is my herder, ek kom niks kort nie." — Psalm 23:1',
      '"Ek weet watter planne Ek vir julle het: voorspoed en nie teenspoed nie." — Jeremia 29:11',
    ],
  },
  anniversary: {
    en: [
      '"Love bears all things, believes all things, hopes all things, endures all things." — 1 Corinthians 13:7',
      '"What God has joined together, let no one separate." — Mark 10:9',
      '"Above all, clothe yourselves with love, which binds everything together in perfect harmony." — Colossians 3:14',
      '"Two are better than one, because they have a good reward for their labour." — Ecclesiastes 4:9',
    ],
    af: [
      '"Die liefde bedek alles, glo alles, hoop alles, verdra alles." — 1 Korintiërs 13:7',
      '"Wat God dan saamgevoeg het, mag \'n mens nie skei nie." — Markus 10:9',
      '"Bo dit alles moet julle mekaar liefhê: dit is die band wat alles volmaak saambind." — Kolossense 3:14',
      '"Twee vaar beter as een, want saam kry hulle \'n goeie beloning vir hulle swaarkry." — Prediker 4:9',
    ],
  },
};

/** The same person is not given the same line every year, and the preview holds still while the wordings are tried. */
function pickScripture(ctx) {
  const pool = SCRIPTURES[ctx.type][ctx.language];
  const seed = Number(ctx.person.memberNo.slice(-3) || 0) + ctx.date.getFullYear();
  return pool[seed % pool.length];
}

const T = (id, type, language, label, body, extra) => ({ id, type, language, label, body, ...(extra || {}) });

export const BIRTHDAY_TEMPLATES = [
  T('bd-en-warm', 'birthday', 'en', 'Warm and pastoral',
    'Dear {salutation}\n\nHappy birthday! 🎂 On behalf of the {congregation} congregation, I wish you a truly blessed day.\n\nMay the Lord grant you health, peace and joy in the year ahead, and may you feel His nearness in every day of it.\n\nWith warm regards\n{sender}',
    { bands: ['adult', 'senior', 'teen'] }),
  T('bd-en-scripture', 'birthday', 'en', 'With a scripture',
    'Dear {salutation}\n\nA very happy birthday to you! 🎉\n\n{scripture}\n\nMay this new year of your life be filled with God\'s blessing and care. We are thankful for you in our congregation.\n\nKind regards\n{sender}',
    { bands: ['adult', 'senior', 'teen'] }),
  T('bd-en-brief', 'birthday', 'en', 'Short and friendly',
    'Happy birthday, {first}! 🎂 Wishing you a wonderful day and a blessed year ahead.\n\n{sender}', { bands: ['any'] }),
  T('bd-en-child', 'birthday', 'en', 'For a child',
    'Happy birthday, {first}! 🎉🎂\n\nWe hope you have a really special day today with lots of fun. God bless you, and we look forward to seeing you at church!\n\n{sender}', { bands: ['child'] }),
  T('bd-en-child-age', 'birthday', 'en', 'For a child (names the age)',
    'Happy birthday, {first}! 🎈 {age} today!\n\nHave a wonderful day. May God bless you and keep you safe and happy this year.\n\n{sender}', { bands: ['child', 'teen'] }),
  T('bd-en-milestone', 'birthday', 'en', 'Milestone birthday',
    'Dear {salutation}\n\nCongratulations on your {age}th birthday! 🎉 What a milestone to celebrate.\n\nWe give thanks for all the Lord has carried you through, and we wish you His richest blessing for the years still ahead. Enjoy your special day.\n\nWarm regards\n{sender}',
    { milestoneOnly: true }),
  T('bd-en-senior', 'birthday', 'en', 'For an older member',
    'Dear {salutation}\n\nWishing you a very happy and blessed birthday. 🌷\n\nThank you for your faithfulness and for all you mean to our congregation. May the Lord grant you good health, strength and much joy in the year ahead.\n\nWith respect and warm greetings\n{sender}',
    { bands: ['senior'] }),
  T('bd-en-visit', 'birthday', 'en', 'Invites a visit or call',
    'Dear {salutation}\n\nHappy birthday! 🎂 I hope your day is a blessed and restful one.\n\nIf it suits you, I would gladly pop in or give you a call this week — just let me know what works.\n\nKind regards\n{sender}',
    { bands: ['any'] }),

  T('bd-af-warm', 'birthday', 'af', 'Warm en pastoraal',
    'Liewe {salutation}\n\nBaie geluk met jou verjaarsdag! 🎂 Namens die gemeente {congregation} wens ek jou \'n geseënde dag toe.\n\nMag die Here jou gesondheid, vrede en vreugde skenk in die jaar wat voorlê, en mag jy Sy nabyheid elke dag ervaar.\n\nVriendelike groete\n{sender}',
    { bands: ['adult', 'senior', 'teen'] }),
  T('bd-af-scripture', 'birthday', 'af', 'Met \'n Skrifwoord',
    'Liewe {salutation}\n\nHartlik geluk met jou verjaarsdag! 🎉\n\n{scripture}\n\nMag hierdie nuwe lewensjaar vol van die Here se seën en sorg wees. Ons is dankbaar vir jou in ons gemeente.\n\nGroete\n{sender}',
    { bands: ['adult', 'senior', 'teen'] }),
  T('bd-af-brief', 'birthday', 'af', 'Kort en vriendelik',
    'Baie geluk met jou verjaarsdag, {first}! 🎂 Geniet jou dag en mag die jaar wat kom geseënd wees.\n\n{sender}', { bands: ['any'] }),
  T('bd-af-child', 'birthday', 'af', 'Vir \'n kind',
    'Baie geluk met jou verjaarsdag, {first}! 🎉🎂\n\nOns hoop jy het vandag \'n heerlike, spesiale dag. Mag die Here jou seën — ons sien uit daarna om jou by die kerk te sien!\n\n{sender}', { bands: ['child'] }),
  T('bd-af-child-age', 'birthday', 'af', 'Vir \'n kind (noem die ouderdom)',
    'Baie geluk, {first}! 🎈 Vandag {age} jaar oud!\n\nGeniet elke oomblik van jou dag. Mag die Here jou seën en bewaar in hierdie jaar.\n\n{sender}', { bands: ['child', 'teen'] }),
  T('bd-af-milestone', 'birthday', 'af', 'Mylpaal-verjaarsdag',
    'Liewe {salutation}\n\nHartlik geluk met jou {age}de verjaarsdag! 🎉 Wat \'n mylpaal om te vier.\n\nOns is dankbaar vir alles waardeur die Here jou gedra het, en ons wens jou Sy ryke seën toe vir die jare wat voorlê. Geniet jou spesiale dag.\n\nVriendelike groete\n{sender}',
    { milestoneOnly: true }),
  T('bd-af-senior', 'birthday', 'af', 'Vir \'n ouer lidmaat',
    'Liewe {salutation}\n\nEk wens jou \'n baie geseënde verjaarsdag toe. 🌷\n\nDankie vir jou getrouheid en vir alles wat jy vir ons gemeente beteken. Mag die Here jou gesondheid, krag en baie vreugde gee in die jaar wat kom.\n\nMet agting en warm groete\n{sender}',
    { bands: ['senior'] }),
  T('bd-af-visit', 'birthday', 'af', 'Nooi \'n besoek of oproep',
    'Liewe {salutation}\n\nBaie geluk met jou verjaarsdag! 🎂 Ek hoop jou dag is geseënd en rustig.\n\nAs dit jou pas, kom ek graag hierdie week kuier of bel — laat my net weet wat vir jou werk.\n\nGroete\n{sender}',
    { bands: ['any'] }),
];

export const ANNIVERSARY_TEMPLATES = [
  T('an-en-warm', 'anniversary', 'en', 'Warm and pastoral',
    'Dear {couple}\n\nCongratulations on your wedding anniversary! 💐\n\nMay the Lord continue to bless your marriage with love, patience and joy, and may He keep you close to one another and to Him.\n\nWith warm regards\n{sender}'),
  T('an-en-years', 'anniversary', 'en', 'Names the years',
    'Dear {couple}\n\nCongratulations on {years} years of marriage! 💍\n\nWhat a blessing to look back on. We wish you many more years together, carried by God\'s grace and love.\n\nKind regards\n{sender}'),
  T('an-en-scripture', 'anniversary', 'en', 'With a scripture',
    'Dear {couple}\n\nA blessed wedding anniversary {toYou}. 💐\n\n{scripture}\n\nMay your home continue to be a place of peace and love. The {congregation} congregation celebrates with you today.\n\nWarm regards\n{sender}'),
  T('an-en-milestone', 'anniversary', 'en', 'Milestone anniversary',
    'Dear {couple}\n\nCongratulations on {years} years of marriage — what a wonderful milestone! 🎉💍\n\nThank you for the example your marriage sets in our congregation. We give thanks for God\'s faithfulness over these years and wish you His blessing for all that lies ahead.\n\nWith warm regards\n{sender}',
    { milestoneOnly: true }),
  T('an-en-brief', 'anniversary', 'en', 'Short and friendly',
    'Happy anniversary, {coupleFirst}! 💐 Wishing you a blessed day together.\n\n{sender}'),

  T('an-af-warm', 'anniversary', 'af', 'Warm en pastoraal',
    'Liewe {couple}\n\nBaie geluk met julle huweliksherdenking! 💐\n\nMag die Here julle huwelik verder seën met liefde, geduld en vreugde, en mag Hy julle na aan mekaar en na aan Hom hou.\n\nVriendelike groete\n{sender}'),
  T('an-af-years', 'anniversary', 'af', 'Noem die jare',
    'Liewe {couple}\n\nBaie geluk met {years} jaar getroud! 💍\n\nWat \'n voorreg om op terug te kyk. Ons wens julle nog baie jare saam toe, gedra deur die Here se genade en liefde.\n\nGroete\n{sender}'),
  T('an-af-scripture', 'anniversary', 'af', 'Met \'n Skrifwoord',
    'Liewe {couple}\n\n\'n Geseënde huweliksherdenking {toYou}. 💐\n\n{scripture}\n\nMag julle huis \'n plek van vrede en liefde bly. Die gemeente {congregation} vier vandag saam met julle.\n\nVriendelike groete\n{sender}'),
  T('an-af-milestone', 'anniversary', 'af', 'Mylpaal-herdenking',
    'Liewe {couple}\n\nBaie geluk met {years} jaar getroud — wat \'n pragtige mylpaal! 🎉💍\n\nDankie vir die voorbeeld wat julle huwelik in ons gemeente stel. Ons is dankbaar vir die Here se getrouheid oor hierdie jare en wens julle Sy seën toe vir alles wat voorlê.\n\nVriendelike groete\n{sender}',
    { milestoneOnly: true }),
  T('an-af-brief', 'anniversary', 'af', 'Kort en vriendelik',
    'Baie geluk met julle herdenking, {coupleFirst}! 💐 Mag julle dag saam geseënd wees.\n\n{sender}'),
];

export const ALL_TEMPLATES = [...BIRTHDAY_TEMPLATES, ...ANNIVERSARY_TEMPLATES];

/** 21st, not 21th. */
export function ordinal(n) {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
/** Afrikaans: 1ste, 8ste, 20ste; the rest take -de. */
export function ordinalAf(n) {
  if (n === 1 || n % 10 === 8 || (n >= 20 && n % 10 === 0)) return `${n}ste`;
  return `${n}de`;
}

/**
 * Fills a wording in. ctx: {person, partners, type, count, date, language,
 * senderName, congregationName}. `{age}th` and `{age}de` in a wording are
 * corrected to the right suffix for the real number.
 */
export function fillPlaceholders(body, ctx) {
  const { person, partners, language, count } = ctx;
  const everyone = [person, ...partners];
  const values = {
    salutation: salutation(person, language, ctx.type === 'birthday' ? count : undefined),
    name: displayName(person),
    first: firstName(person),
    surname: person.surname,
    title: person.title,
    couple: coupleSalutation(everyone, language),
    coupleFirst: coupleFirstNames(everyone, language),
    age: count === undefined ? '' : String(count),
    years: count === undefined ? '' : String(count),
    sender: ctx.senderName || '',
    congregation: ctx.congregationName || '',
    date: `${ctx.date.getDate()} ${monthName(ctx.date.getMonth() + 1, language)}`,
    scripture: pickScripture(ctx),
    // "to you both" reads as a slip when only one spouse is a member
    toYou: everyone.length > 1 ? (language === 'af' ? 'vir julle albei' : 'to you both') : (language === 'af' ? 'vir julle' : 'to you'),
  };
  let out = body.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
  if (count !== undefined) {
    out = language === 'af'
      ? out.replace(new RegExp(`\\b${count}(?:de|ste)\\b`, 'g'), ordinalAf(count))
      : out.replace(new RegExp(`\\b${count}(?:st|nd|rd|th)\\b`, 'g'), ordinal(count));
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The wordings that suit this event, best fit first: {language,
 * includeScripture, custom} where custom are the minister's own
 * [{id, type, language, label, body}].
 */
export function templatesFor(event, { language, includeScripture = true, custom = [] }) {
  const band = event.type === 'birthday' ? ageBand(event.count) : 'any';
  const builtIn = ALL_TEMPLATES.filter(tp => {
    if (tp.type !== event.type || tp.language !== language) return false;
    if (!includeScripture && tp.body.includes('{scripture}')) return false;
    if (tp.milestoneOnly && !event.isMilestone) return false;
    if (tp.coupleOnly && !event.partners.length) return false;
    if (event.count === undefined && /\{(age|years)\}/.test(tp.body)) return false;
    if (event.type !== 'birthday' || !tp.bands || tp.bands.includes('any')) return true;
    return tp.bands.includes(band);
  });
  builtIn.sort((a, b) => Number(!!b.milestoneOnly) - Number(!!a.milestoneOnly));   // a milestone is the headline, so it leads
  const own = custom.filter(c => c.type === event.type && c.language === language).map(c => ({ id: c.id, type: c.type, language: c.language, label: c.label, body: c.body, own: true }));
  return [...builtIn, ...own];
}
