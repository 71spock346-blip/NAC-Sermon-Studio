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
 * agrees word for word. The Afrikaans Creed goes in here as a second copy
 * when its text comes.
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
export const CREED = [book('en', EN)];
