/*
 * The Creed of the New Apostolic Church: the ten Articles of Faith, as the
 * Church confesses them and as its Catechism gives them (CNAC 2.4.1 to
 * 2.4.10, where each article is explained). The Creed is short and is the
 * Church's public confession, so it is part of the app itself, with nothing
 * to load: handbooks.js lists it first among the handbooks, in the shape
 * handbook.js gives a loaded one (a chapter per article, one block each),
 * so it reads, searches and answers like them. The minister gave the
 * English text of articles 4 to 10 himself (2026-11-17); articles 1 to 3
 * are from the Catechism's English edition (2012), with which his text
 * agrees word for word; he sent the Afrikaans text of all ten the same day,
 * and both stand here exactly as sent. An app in Afrikaans shows the
 * Afrikaans copy; the EN | AF switch on the Creed's pages shows the other.
 */

const EN = {
  title: 'The Creed',
  ownTitle: 'The Creed of the New Apostolic Church',
  articles: [
    ['The First Article of Faith', 'I believe in God, the Father, the Almighty, the Creator of heaven and earth.'],
    ['The Second Article of Faith', 'I believe in Jesus Christ, the only begotten Son of God, our Lord, who was conceived by the Holy Spirit, born of the virgin Mary, suffered under Pontius Pilate, was crucified, died, and was buried, entered the realm of the dead, rose again from the dead on the third day, and ascended into heaven. He is seated at the right hand of God, the Father Almighty, from where He will return.'],
    ['The Third Article of Faith', 'I believe in the Holy Spirit, the one, holy, universal, and apostolic church, the community of the saints, the forgiveness of sins, the resurrection of the dead, and life everlasting.'],
    ['The Fourth Article of Faith', 'I believe that the Lord Jesus rules His church and thereto sent His Apostles, and until His return still sends them, with the commission to teach, to forgive sins in His name, and to baptise with water and Holy Spirit.'],
    ['The Fifth Article of Faith', 'I believe that those designated by God for a ministry are ordained only by Apostles, and that authority, blessing, and sanctification for their ministration come forth out of the Apostle ministry.'],
    ['The Sixth Article of Faith', 'I believe that the Holy Baptism with water is the first step to a renewal of a human being in the Holy Spirit, and that the person baptised is adopted into the fellowship of those who believe in Jesus Christ and profess Him as their Lord.'],
    ['The Seventh Article of Faith', 'I believe that Holy Communion was instituted by the Lord Himself in memory of the once brought, fully valid sacrifice, and bitter suffering and death of Christ. The worthy partaking of Holy Communion establishes our fellowship with Jesus Christ, our Lord. It is celebrated with unleavened bread and wine; both must be consecrated and dispensed by a minister authorised by an Apostle.'],
    ['The Eighth Article of Faith', 'I believe that those baptised with water must, through an Apostle, receive the gift of the Holy Spirit to attain the childhood in God and thereby the prerequisite for becoming a firstling.'],
    ['The Ninth Article of Faith', 'I believe that the Lord Jesus will return as surely as He ascended into heaven and that He will take to Himself the firstfruits of the dead and living who have hoped for and were prepared for His coming; that after the marriage in heaven He will return to earth with them to establish His kingdom of peace, and that they will reign with Him as a royal priesthood. After the conclusion of the kingdom of peace, He will hold the Last Judgement. Then God will create a new heaven and a new earth and dwell with His people.'],
    ['The Tenth Article of Faith', 'I believe that I am obliged to obey the worldly authorities provided no godly laws are thereby transgressed.'],
  ],
};

const AF = {
  title: 'Die Geloofsbelydenis',
  ownTitle: 'Die Tien Geloofsartikels van die Nuwe Apostoliese Kerk',
  articles: [
    ['Die Eerste Geloofsartikel', 'Ek glo in God, die Vader, die Almagtige, die Skepper van die hemel en die aarde.'],
    ['Die Tweede Geloofsartikel', 'Ek glo in Jesus Christus, die eniggebore Seun van God, ons Here, wat deur die Heilige Gees ontvang en uit die maagd Maria gebore is, wat onder Pontius Pilatus gely het, gekruisig is, gesterf het en begrawe is, wat neergedaal het na die ryk van die dode, op die derde dag uit die dood opgestaan het en opgevaar het na die hemel. Hy sit aan die regterhand van God, die almagtige Vader, vanwaar Hy sal terugkom.'],
    ['Die Derde Geloofsartikel', 'Ek glo in die Heilige Gees, die een, heilige, algemene en apostoliese kerk, die gemeenskap van die heiliges, die vergewing van sondes, die opstanding van die dode en die ewige lewe.'],
    ['Die Vierde Geloofsartikel', 'Ek glo dat die Here Jesus oor sy kerk heers en dat Hy sy Apostels daarvoor gestuur het en tot met sy wederkoms steeds stuur, met die opdrag om te onderrig, om in sy Naam sondes te vergewe en met water en die Heilige Gees te doop.'],
    ['Die Vyfde Geloofsartikel', 'Ek glo dat diegene wat deur God vir \'n amp bestem is, slegs deur Apostels georden word, en dat die gesag, seën en heiliging vir hulle dienswerk uit die Apostelamp voortvloei.'],
    ['Die Sesde Geloofsartikel', 'Ek glo dat die Heilige Doop met water die eerste stap is tot die vernuwing van die mens deur die Heilige Gees, en dat die gedoopte persoon in die gemeenskap opgeneem word van diegene wat in Jesus Christus glo en Hom as hulle Here bely.'],
    ['Die Sewende Geloofsartikel', 'Ek glo dat die Heilige Nagmaal deur die Here self ingestel is ter herinnering aan die eenmalige, volkome geldige offer, asook die bittere lyding en dood van Christus. Die waardige gebruik van die Heilige Nagmaal bewerkstellig ons gemeenskap met Jesus Christus, ons Here. Dit word met ongesuurde brood en wyn gevier. Beide moet deur \'n bedienaar wat deur \'n Apostel gemagtig is, geheilig en uitgedeel word.'],
    ['Die Agste Geloofsartikel', 'Ek glo dat diegene wat met water gedoop is, deur bemiddeling van \'n Apostel die gawe van die Heilige Gees moet ontvang om die kindskap van God te verkry en sodoende die voorvereiste te hê om \'n eersteling te word.'],
    ['Die Negende Geloofsartikel', 'Ek glo dat die Here Jesus net so seker sal terugkom as wat Hy na die hemel opgevaar het, en dat Hy die eerstelinge uit die dode en die lewendes tot Hom sal neem wat op sy wederkoms gehoop en hulle daarop voorberei het. Ná die bruilof in die hemel sal Hy saam met hulle na die aarde terugkeer om sy vrederyk op te rig, en hulle sal saam met Hom as \'n koninklike priesterdom regeer. Ná die afsluiting van die vrederyk sal Hy die Laaste Oordeel hou. Daarna sal God \'n nuwe hemel en \'n nuwe aarde skep en by sy volk woon.'],
    ['Die Tiende Geloofsartikel', 'Ek glo dat ek verplig is om die wêreldlike owerhede te gehoorsaam, mits geen goddelike wette daardeur oortree word nie.'],
  ],
};

/**
 * The Creed in the shape of a loaded handbook (handbook.js), so that
 * handbooks.js can list, search and ask it like one: `builtIn` tells it
 * apart (nothing to load or remove, no file, no page numbers). Each article
 * is a chapter numbered 1 to 10, with one paragraph and, in `cat`, the
 * section of the Catechism that explains it.
 */
function book(language, c) {
  return {
    id: 'creed:' + language, key: 'creed', language, builtIn: true,
    title: c.title, ownTitle: c.ownTitle, org: 'New Apostolic Church',
    chapters: c.articles.map(([title, text], i) => ({ n: String(i + 1), title, level: 1, page: 0, cat: '2.4.' + (i + 1), blocks: [{ k: 'p', d: 0, t: [[text, '']] }] })),
  };
}

/** The Creed, one copy per language it is written in; built once, so a copy is the same object each time it is listed. */
export const CREED = [book('en', EN), book('af', AF)];
