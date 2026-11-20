/**
 * Planted test set for name redaction: 60 sentences, each holding one invented name, and 30 clean sentences that hold
 * capitalized words that are not names.
 *
 * Written on 2026-11-19 before the name rules existed, and not to be edited to raise a score. The forms were chosen to
 * look like customer comments, and several are forms a rule set is expected to miss: lowercase names, a surname alone,
 * a name with no cue that is not a common first name, and a nickname. Those stay in so the report shows real misses.
 *
 * Every name is invented by combining common given names and surnames. No sentence describes a real person.
 */

export type PlantedName = { id: string; variant: string; text: string; value: string };

const ITEMS: readonly [variant: string, text: string, value: string][] = [
  // Sign-offs, the form the comment generator uses.
  ["sign-off", "Box arrived crushed. Thanks, Priya Raman.", "Priya Raman"],
  ["sign-off", "Love the color. Cheers, Tom", "Tom"],
  ["sign-off", "Would order again.\nRegards, Ana Lucia Ortiz", "Ana Lucia Ortiz"],
  ["sign-off", "Please fix the zipper. Best, Kwame Mensah", "Kwame Mensah"],
  ["sign-off", "The refund took weeks. Sincerely, Hannah O'Neill", "Hannah O'Neill"],
  ["sign-off", "Quick delivery. Many thanks, Li Wei", "Li Wei"],
  ["sign-off", "Great fit. Thank you, José García", "José García"],
  ["sign-off", "Thanks Marisol for the help with my return.", "Marisol"],
  // Introductions.
  ["introduction", "My name is Daniel Kim and my order never came.", "Daniel Kim"],
  ["introduction", "I'm Fatima Al-Sayed, a long time customer.", "Fatima Al-Sayed"],
  ["introduction", "This is Grace Liu writing about order 4471.", "Grace Liu"],
  ["introduction", "Hello, my name's Bjorn Eriksen and the lid is cracked.", "Bjorn Eriksen"],
  ["introduction", "I am Noah Fitzgerald and I want a refund.", "Noah Fitzgerald"],
  // Titles.
  ["title", "Mr. Patel at the store was very patient.", "Patel"],
  ["title", "My doctor, Dr. Elena Rossi, recommended this pillow.", "Elena Rossi"],
  ["title", "Ms Okoye answered within an hour.", "Okoye"],
  ["title", "Mrs. Takahashi wrapped it beautifully.", "Takahashi"],
  // Staff and people mentioned by role.
  ["role", "The agent Marcus was rude to me on the phone.", "Marcus"],
  ["role", "A driver named Luis left it at the wrong door.", "Luis"],
  ["role", "I spoke with Jennifer Brooks and she sorted it out.", "Jennifer Brooks"],
  ["role", "Ask for Deepak, he knows the sizes.", "Deepak"],
  ["role", "The manager, Colleen, gave me store credit.", "Colleen"],
  ["role", "Someone called Rafael Moreno phoned me twice.", "Rafael Moreno"],
  // Greetings.
  ["greeting", "Hi Sam, the strap broke after a week.", "Sam"],
  ["greeting", "Dear Ingrid, thank you for the note in the box.", "Ingrid"],
  ["greeting", "Hello Aisha! The tea set is lovely.", "Aisha"],
  // A common first name with no cue.
  ["first name, no cue", "Sarah helped me find the right size.", "Sarah"],
  ["first name, no cue", "Checkout was quick because Ahmed was on the till.", "Ahmed"],
  ["first name, no cue", "My sister Emily loved the scarf.", "Emily"],
  ["first name, no cue", "David at the warehouse called about the delay.", "David"],
  ["first name, no cue", "I bought it for Olivia Chen as a gift.", "Olivia Chen"],
  ["first name, no cue", "Michael said it would ship Monday, it did not.", "Michael"],
  ["first name, no cue", "The note from Maria was a nice touch.", "Maria"],
  ["first name, no cue", "Carlos Mendez fixed my account in minutes.", "Carlos Mendez"],
  ["first name, no cue", "We gave one to James and one to Laura.", "James"],
  ["first name, no cue", "Wei and I split the bundle.", "Wei"],
  // Possessives.
  ["possessive", "Kevin's advice on the battery was right.", "Kevin"],
  ["possessive", "It matched Nadia's description exactly.", "Nadia"],
  // Names not common in an English first name list, with no cue.
  ["uncommon name, no cue", "Zebulon fixed the hinge for free.", "Zebulon"],
  ["uncommon name, no cue", "Oluwaseun at support was brilliant.", "Oluwaseun"],
  ["uncommon name, no cue", "Siobhan Kearney packed it with care.", "Siobhan Kearney"],
  ["uncommon name, no cue", "Thank goodness Anneliese caught the mistake.", "Anneliese"],
  // A surname alone.
  ["surname only", "Okafor called me back the next day.", "Okafor"],
  ["surname only", "The courier, Lindqvist, was very polite.", "Lindqvist"],
  // Lowercase, as people type in a hurry.
  ["lowercase", "thanks, john smith", "john smith"],
  ["lowercase", "my name is rachel and the box was empty", "rachel"],
  ["lowercase", "spoke to mike in returns, no help at all", "mike"],
  // Nicknames and short forms.
  ["nickname", "Big Mo at the front desk sorted it.", "Mo"],
  ["nickname", "Ask for Bo, he is the best.", "Bo"],
  // Names inside longer sentences, mid sentence.
  ["mid sentence", "The parcel was signed for by Rebecca Stone at 3 pm.", "Rebecca Stone"],
  ["mid sentence", "Support, especially Arjun, went above and beyond.", "Arjun"],
  ["mid sentence", "After two calls, Megan finally found my order.", "Megan"],
  ["mid sentence", "It was my neighbor Hiroshi who took it in.", "Hiroshi"],
  ["mid sentence", "Please pass this on to Chloe in billing.", "Chloe"],
  // Names next to other details.
  ["with other detail", "Ring me, Peter Novak, on the number on file.", "Peter Novak"],
  ["with other detail", "Ship to Leah at the office from now on.", "Leah"],
  ["with other detail", "Order placed by Ethan Walsh last Tuesday.", "Ethan Walsh"],
  // Names that are also ordinary words.
  ["word name", "Will from the warehouse rang me.", "Will"],
  ["word name", "Grace in returns was kind.", "Grace"],
  ["word name", "I spoke to Rose about the stain.", "Rose"],
];

export const PLANTED_NAMES: readonly PlantedName[] = ITEMS.map(([variant, text, value], i) => ({
  id: `name-${String(i + 1).padStart(2, "0")}`,
  variant,
  text,
  value,
}));

/** Sentences with capitalized words that are not names. A finding here is a false alarm. */
export const CLEAN_SENTENCES: readonly string[] = [
  "I live in New York and it took a week.",
  "The Black Friday deal was the best price I found.",
  "Ordered the Galaxy case in Midnight Blue.",
  "Shipped by UPS Ground, arrived Monday.",
  "Thanks, great service!",
  "Best price anywhere, will buy again.",
  "May was a slow month for deliveries.",
  "Will it ship to Canada?",
  "Hope it arrives before Christmas.",
  "Dear customer service team, the box was wet.",
  "Hi there, the size chart is wrong.",
  "This is Ridiculous, three weeks and nothing.",
  "Best Buy had it cheaper.",
  "The Apple Watch band fits well.",
  "Amazon delivered it faster last time.",
  "Got the Pro Max version by mistake.",
  "The Sunday delivery slot was missed.",
  "Cheers for the quick reply!",
  "I'm happy with the Premium plan.",
  "Spoke to Customer Service and they were great.",
  "Asked for a Refund twice.",
  "The Christmas Gift Guide was helpful.",
  "We drove to San Diego to pick it up.",
  "Regards to the Packing Team, nice work.",
  "My order from the Spring Sale is missing.",
  "Love it. Five stars.",
  "The Instant Pot lid does not fit.",
  "Called the Help Desk at noon.",
  "Thank you for the Free Shipping.",
  "Mark the parcel fragile next time.",
];
