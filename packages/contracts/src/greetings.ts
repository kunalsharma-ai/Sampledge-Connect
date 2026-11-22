import { z } from 'zod';

/**
 * Greeting cards: ready-made cards for festivals and occasions that people send in any chat.
 *
 * A greeting is an ordinary text message: `content.text` is the message (so search,
 * notifications, forwarding, editing and older apps all keep working) and
 * `metadata.greeting` says how to draw it (occasion, style, headline, who it is for).
 * Sending goes through the normal outbox, so it works offline and syncs like any message.
 * The artwork is original SVG drawn by `greetingCardLook()` in @sampledge/design-tokens.
 */

export const GREETING_CATEGORIES = [
  { id: 'india', name: 'Festivals of India' },
  { id: 'world', name: 'Festivals around the world' },
  { id: 'life', name: 'Life moments' },
  { id: 'work', name: 'At work' },
  { id: 'care', name: 'Care and support' },
] as const;
export type GreetingCategory = (typeof GREETING_CATEGORIES)[number]['id'];
const CATEGORY_IDS = GREETING_CATEGORIES.map((c) => c.id) as [
  GreetingCategory,
  ...GreetingCategory[],
];
export const GreetingCategorySchema = z.enum(CATEGORY_IDS);

export const GREETING_TONES = [
  { id: 'warm', name: 'Warm' },
  { id: 'formal', name: 'For colleagues and clients' },
  { id: 'playful', name: 'Playful' },
  { id: 'poetic', name: 'Poetic' },
] as const;
export type GreetingTone = (typeof GREETING_TONES)[number]['id'];

export const GREETING_STYLES = [
  { id: 'radiant', name: 'Radiant', description: 'Rich colour and a soft glow' },
  { id: 'elegant', name: 'Elegant', description: 'Ivory paper with a gold frame' },
  { id: 'festive', name: 'Festive', description: 'Bright patterns and confetti' },
  { id: 'minimal', name: 'Minimal', description: 'Calm, clean and simple' },
  { id: 'midnight', name: 'Midnight', description: 'Deep night sky with gold light' },
] as const;
export type GreetingStyleId = (typeof GREETING_STYLES)[number]['id'];
const STYLE_IDS = GREETING_STYLES.map((s) => s.id) as [GreetingStyleId, ...GreetingStyleId[]];
export const GreetingStyleIdSchema = z.enum(STYLE_IDS);

export interface GreetingMessage {
  tone: GreetingTone;
  text: string;
}

export interface GreetingOccasion {
  id: string;
  name: string;
  category: GreetingCategory;
  emoji: string;
  /** Months (1–12) it usually falls in, for "Coming up". Empty = any time. */
  months: readonly number[];
  /** Headline options; the first is the default. */
  titles: readonly string[];
  /** Message options in several tones. */
  messages: readonly GreetingMessage[];
  /** Extra words people may search for. */
  keywords?: readonly string[];
  /** Muted, respectful artwork and no confetti (condolences). */
  quiet?: boolean;
}

const o = (x: GreetingOccasion) => x;

export const GREETING_OCCASIONS = [
  // ---------------- Festivals of India ----------------
  o({
    id: 'diwali',
    name: 'Diwali',
    category: 'india',
    emoji: '🪔',
    months: [10, 11],
    keywords: ['deepavali', 'festival of lights', 'lakshmi puja'],
    titles: ['Happy Diwali', 'Shubh Deepavali', 'Wishing you a bright Diwali'],
    messages: [
      {
        tone: 'warm',
        text: 'May every diya you light tonight bring a little more warmth into your home, and may the year ahead be full of laughter, good health and the people you love most. Happy Diwali to you and your family!',
      },
      {
        tone: 'formal',
        text: 'Wishing you and your loved ones a joyful and prosperous Diwali. Thank you for everything we have built together this year. May the festival of lights bring you success, peace and many reasons to celebrate.',
      },
      {
        tone: 'playful',
        text: 'Sweets: unlimited. Diets: on pause. Lights: on. Wishing you the sparkliest, tastiest, happiest Diwali yet. Save me a kaju katli!',
      },
      {
        tone: 'poetic',
        text: 'One small flame can chase away a whole night. This Diwali, may your heart find its light, your home its glow, and your dreams the courage to shine. Shubh Deepavali.',
      },
    ],
  }),
  o({
    id: 'holi',
    name: 'Holi',
    category: 'india',
    emoji: '🎨',
    months: [3],
    keywords: ['festival of colours', 'rang'],
    titles: ['Happy Holi', 'Rang Barse!', 'A colourful Holi to you'],
    messages: [
      {
        tone: 'warm',
        text: 'May your life be as bright as the colours in the air today, and as sweet as the gujiyas on the plate. Wishing you a Holi full of love, laughter and friends who never let you stay clean!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes to you and your family on Holi. May this festival of colours bring fresh energy, new beginnings and great happiness to you and everyone around you.',
      },
      {
        tone: 'playful',
        text: 'Consider this your official warning: I am coming with gulaal. Happy Holi! Wear white at your own risk.',
      },
      {
        tone: 'poetic',
        text: 'Pink for joy, yellow for hope, green for new beginnings, blue for calm. May every colour of Holi find its way into your days. Bura na mano, Holi hai!',
      },
    ],
  }),
  o({
    id: 'raksha-bandhan',
    name: 'Raksha Bandhan',
    category: 'india',
    emoji: '🧵',
    months: [8],
    keywords: ['rakhi', 'brother', 'sister', 'sibling'],
    titles: ['Happy Raksha Bandhan', 'Happy Rakhi', 'To my favourite sibling'],
    messages: [
      {
        tone: 'warm',
        text: 'A thread so thin, and yet it holds a lifetime of fights, secrets, laughter and love. Thank you for always being in my corner. Happy Raksha Bandhan!',
      },
      {
        tone: 'formal',
        text: 'Wishing you and your family a happy Raksha Bandhan. May the bond of love and care between brothers and sisters keep growing stronger every year.',
      },
      {
        tone: 'playful',
        text: 'You still owe me for every time I didn’t tell Mom. The rakhi is a reminder. The gift is the payment. Happy Rakhi!',
      },
      {
        tone: 'poetic',
        text: 'We grew up side by side, and somewhere along the way you became my safest place. This thread is my promise: wherever life takes us, I am with you.',
      },
    ],
  }),
  o({
    id: 'janmashtami',
    name: 'Janmashtami',
    category: 'india',
    emoji: '🪈',
    months: [8, 9],
    keywords: ['krishna', 'gokulashtami', 'dahi handi'],
    titles: ['Happy Janmashtami', 'Jai Shri Krishna', 'Joyful Janmashtami'],
    messages: [
      {
        tone: 'warm',
        text: 'May the sweet melody of Krishna’s flute fill your home with joy, and may his blessings bring love, wisdom and mischief-filled happiness to your family. Happy Janmashtami!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on the auspicious occasion of Janmashtami. May this festival bring peace, prosperity and happiness to you and your loved ones.',
      },
      {
        tone: 'playful',
        text: 'Hide the makhan, lock the matki, Kanha is on his way! Wishing you a fun-filled Janmashtami.',
      },
      {
        tone: 'poetic',
        text: 'At midnight a little light was born, and the world has been singing ever since. May that music find you today and stay with you always.',
      },
    ],
  }),
  o({
    id: 'ganesh-chaturthi',
    name: 'Ganesh Chaturthi',
    category: 'india',
    emoji: '🌼',
    months: [8, 9],
    keywords: ['ganpati', 'vinayaka', 'bappa'],
    titles: ['Happy Ganesh Chaturthi', 'Ganpati Bappa Morya!', 'Blessings this Ganesh Chaturthi'],
    messages: [
      {
        tone: 'warm',
        text: 'May Bappa remove every obstacle from your path, fill your home with modaks and laughter, and bless you with wisdom and good fortune. Ganpati Bappa Morya!',
      },
      {
        tone: 'formal',
        text: 'Wishing you and your family a blessed Ganesh Chaturthi. May this auspicious festival bring new beginnings, success and lasting happiness.',
      },
      {
        tone: 'playful',
        text: 'Bappa is home, the modaks are ready and the dhol is loud. Wishing you ten days of joy (and at least ten modaks a day)!',
      },
      {
        tone: 'poetic',
        text: 'With folded hands and an open heart, I wish you a path made clear, a mind made calm, and a home that is never short of sweetness.',
      },
    ],
  }),
  o({
    id: 'navratri',
    name: 'Navratri',
    category: 'india',
    emoji: '🥢',
    months: [9, 10],
    keywords: ['garba', 'dandiya', 'durga', 'nine nights'],
    titles: ['Happy Navratri', 'Shubh Navratri', 'Nine nights of joy'],
    messages: [
      {
        tone: 'warm',
        text: 'May the nine nights of Navratri bring you nine reasons to smile every day: strength, peace, health, love, courage, wisdom, success, joy and family. Shubh Navratri!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes for a blessed Navratri. May the Goddess grant you and your family strength, prosperity and happiness in the year ahead.',
      },
      {
        tone: 'playful',
        text: 'Chaniya choli ready, dandiya sticks polished, sleep schedule cancelled. See you on the garba floor! Happy Navratri!',
      },
      {
        tone: 'poetic',
        text: 'Nine nights, a thousand lamps, and the steady rhythm of feet that dance as one. May this season fill you with light and leave you a little braver.',
      },
    ],
  }),
  o({
    id: 'durga-puja',
    name: 'Durga Puja',
    category: 'india',
    emoji: '🪷',
    months: [9, 10],
    keywords: ['pujo', 'bijoya', 'shubho', 'maa durga'],
    titles: ['Shubho Durga Puja', 'Happy Durga Puja', 'Shubho Bijoya'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you pandal-hopping with your favourite people, endless bhog and adda, and Maa’s blessings for the whole year. Shubho Durga Puja!',
      },
      {
        tone: 'formal',
        text: 'Heartfelt wishes on Durga Puja. May Maa Durga bless you and your family with strength, wisdom and prosperity.',
      },
      {
        tone: 'playful',
        text: 'Five days, a hundred pandals, zero calories counted. Shubho Pujo! Let’s eat like there is no Dashami.',
      },
      {
        tone: 'poetic',
        text: 'The dhak is calling, the air smells of shiuli, and Maa has come home. May she leave you with courage enough for every season ahead.',
      },
    ],
  }),
  o({
    id: 'dussehra',
    name: 'Dussehra',
    category: 'india',
    emoji: '🏹',
    months: [10],
    keywords: ['vijayadashami', 'dasara', 'ravan'],
    titles: ['Happy Dussehra', 'Happy Vijayadashami', 'May goodness always win'],
    messages: [
      {
        tone: 'warm',
        text: 'May this Dussehra burn away every worry and leave room only for happiness, courage and new hope. Wishing you and your family a joyous Vijayadashami!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Dussehra. May the victory of good over evil inspire success and prosperity in all your endeavours.',
      },
      {
        tone: 'playful',
        text: 'Ravan had ten heads and still couldn’t win. You have one, and it’s brilliant. Happy Dussehra!',
      },
      {
        tone: 'poetic',
        text: 'Every year the effigy falls and the sky lights up, reminding us that the dark never wins for long. May your light always find its way.',
      },
    ],
  }),
  o({
    id: 'bhai-dooj',
    name: 'Bhai Dooj',
    category: 'india',
    emoji: '🍬',
    months: [10, 11],
    keywords: ['bhau beej', 'bhai phonta', 'sibling'],
    titles: ['Happy Bhai Dooj', 'For my sibling, with love'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you for being my protector, my partner in crime and my forever friend. Wishing you a long, happy and healthy life. Happy Bhai Dooj!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Bhai Dooj to you and your family. May the love between siblings bring joy to your home today and always.',
      },
      {
        tone: 'playful',
        text: 'Tilak: done. Sweets: done. Gift: pending. Happy Bhai Dooj! (I’m keeping track.)',
      },
      {
        tone: 'poetic',
        text: 'A tilak on the forehead, a prayer in the heart, and a bond that time only makes deeper. May every road you take lead you safely home.',
      },
    ],
  }),
  o({
    id: 'chhath-puja',
    name: 'Chhath Puja',
    category: 'india',
    emoji: '🌅',
    months: [10, 11],
    keywords: ['chhath', 'surya', 'chhathi maiya'],
    titles: ['Happy Chhath Puja', 'Blessings this Chhath'],
    messages: [
      {
        tone: 'warm',
        text: 'May Chhathi Maiya and the rising sun bless your family with good health, happiness and prosperity. Happy Chhath Puja!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on the sacred occasion of Chhath Puja. May the Sun God bless you with energy, health and success.',
      },
      {
        tone: 'playful',
        text: 'Thekua for me, blessings for you, and early mornings for everyone. Happy Chhath Puja!',
      },
      {
        tone: 'poetic',
        text: 'Standing in the water as the sky turns gold, a whole family prays as one. May that light rise for you every morning.',
      },
    ],
  }),
  o({
    id: 'makar-sankranti',
    name: 'Makar Sankranti',
    category: 'india',
    emoji: '🪁',
    months: [1],
    keywords: ['sankranti', 'uttarayan', 'kite', 'til gul'],
    titles: ['Happy Makar Sankranti', 'Happy Uttarayan', 'Til gul ghya, god god bola'],
    messages: [
      {
        tone: 'warm',
        text: 'May your kite fly high, your days grow brighter and your life be as sweet as til and gud. Happy Makar Sankranti!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Makar Sankranti. As the sun begins its northward journey, may it bring warmth, growth and success to you and your family.',
      },
      {
        tone: 'playful',
        text: 'Wishing you a sky full of kites and a manja that never gets cut. Kai po che! Happy Sankranti!',
      },
      {
        tone: 'poetic',
        text: 'The days grow longer, the sky fills with colour, and a new season of harvest begins. May all you have sown come back to you in abundance.',
      },
    ],
  }),
  o({
    id: 'pongal',
    name: 'Pongal',
    category: 'india',
    emoji: '🍚',
    months: [1],
    keywords: ['thai pongal', 'harvest', 'tamil'],
    titles: ['Happy Pongal', 'Iniya Pongal Nalvazhthukkal'],
    messages: [
      {
        tone: 'warm',
        text: 'May your home overflow with joy just like the sweet pongal in the pot, and may this harvest bring you health, love and plenty. Happy Pongal!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Pongal. May this harvest festival bring prosperity, happiness and success to you and your family.',
      },
      {
        tone: 'playful',
        text: 'Pongalo pongal! May the pot boil over, the sugarcane be sweet and the holidays be long.',
      },
      {
        tone: 'poetic',
        text: 'Kolam at the door, sugarcane by the wall, and the first rice of the season rising in the pot. May gratitude fill your home the way it fills this day.',
      },
    ],
  }),
  o({
    id: 'lohri',
    name: 'Lohri',
    category: 'india',
    emoji: '🔥',
    months: [1],
    keywords: ['bonfire', 'punjab', 'harvest'],
    titles: ['Happy Lohri', 'Lohri di lakh lakh vadhaiyan'],
    messages: [
      {
        tone: 'warm',
        text: 'May the warmth of the Lohri fire keep your heart cosy all year, and may your home be full of happiness, rewari and gajak. Happy Lohri!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Lohri. May this harvest festival bring you and your family prosperity, health and happiness.',
      },
      {
        tone: 'playful',
        text: 'Popcorn in the fire, peanuts in the pocket, bhangra in the feet. Happy Lohri! Balle balle!',
      },
      {
        tone: 'poetic',
        text: 'Gather close, the night is cold and the fire is bright. May this flame burn away the old and light the way for everything new.',
      },
    ],
  }),
  o({
    id: 'baisakhi',
    name: 'Baisakhi',
    category: 'india',
    emoji: '🌾',
    months: [4],
    keywords: ['vaisakhi', 'harvest', 'punjab', 'khalsa'],
    titles: ['Happy Baisakhi', 'Happy Vaisakhi'],
    messages: [
      {
        tone: 'warm',
        text: 'May the golden fields of Baisakhi bring a rich harvest of happiness, success and good health into your life. Happy Vaisakhi to you and your family!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Baisakhi. May this new season bring prosperity and fresh opportunities to you and your loved ones.',
      },
      {
        tone: 'playful',
        text: 'Dhol on, bhangra mode activated. Wishing you a Baisakhi as energetic as a wedding sangeet!',
      },
      {
        tone: 'poetic',
        text: 'Wheat bowing gold in the sun, drums calling across the fields. May your hard work always come home to you as a harvest.',
      },
    ],
  }),
  o({
    id: 'onam',
    name: 'Onam',
    category: 'india',
    emoji: '🌸',
    months: [8, 9],
    keywords: ['kerala', 'pookalam', 'sadya', 'thiruvonam'],
    titles: ['Happy Onam', 'Onashamsakal'],
    messages: [
      {
        tone: 'warm',
        text: 'May your pookalam be bright, your sadya be generous and your home be full of people you love. Happy Onam!',
      },
      {
        tone: 'formal',
        text: 'Warm Onam wishes to you and your family. May this festival bring prosperity, harmony and happiness to your home.',
      },
      {
        tone: 'playful',
        text: 'Twenty-six dishes, one banana leaf, zero regrets. Happy Onam! Save some payasam for me.',
      },
      {
        tone: 'poetic',
        text: 'Petal by petal, the pookalam grows, the way good days do, one small joy at a time. May Mahabali find your home overflowing.',
      },
    ],
  }),
  o({
    id: 'ugadi-gudi-padwa',
    name: 'Ugadi and Gudi Padwa',
    category: 'india',
    emoji: '🌿',
    months: [3, 4],
    keywords: ['ugadi', 'gudi padwa', 'new year', 'cheti chand', 'navreh'],
    titles: ['Happy Ugadi', 'Happy Gudi Padwa', 'A happy new year to you'],
    messages: [
      {
        tone: 'warm',
        text: 'May this new year bring you a little of every flavour: sweetness, spice and plenty of joy, just like the Ugadi pachadi. Wishing you a wonderful year ahead!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Ugadi and Gudi Padwa. May the new year bring you good health, new opportunities and lasting success.',
      },
      {
        tone: 'playful',
        text: 'New year, new mango leaves, same wonderful you. Happy Ugadi and Gudi Padwa!',
      },
      {
        tone: 'poetic',
        text: 'A gudi raised high, fresh leaves at the door, and a new year waiting like an open page. May you write something beautiful on it.',
      },
    ],
  }),
  o({
    id: 'maha-shivratri',
    name: 'Maha Shivratri',
    category: 'india',
    emoji: '🌙',
    months: [2, 3],
    keywords: ['shiva', 'shivratri', 'mahadev'],
    titles: ['Happy Maha Shivratri', 'Har Har Mahadev'],
    messages: [
      {
        tone: 'warm',
        text: 'May Mahadev bless you with strength, calm and courage, and may this sacred night bring peace to your heart and home. Happy Maha Shivratri!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Maha Shivratri. May this auspicious night bring you and your family peace, health and prosperity.',
      },
      {
        tone: 'playful',
        text: 'Staying up all night, but for a good reason this time. Wishing you a blessed Maha Shivratri!',
      },
      {
        tone: 'poetic',
        text: 'On the darkest night the mind grows still and the heart listens. May you find in that stillness everything you were looking for.',
      },
    ],
  }),
  o({
    id: 'ram-navami',
    name: 'Ram Navami',
    category: 'india',
    emoji: '🏹',
    months: [3, 4],
    keywords: ['rama', 'navami'],
    titles: ['Happy Ram Navami', 'Jai Shri Ram'],
    messages: [
      {
        tone: 'warm',
        text: 'May Lord Rama bless you with courage, kindness and the strength to always do what is right. Happy Ram Navami to you and your family!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Ram Navami. May this auspicious day bring peace, prosperity and happiness to you and your loved ones.',
      },
      {
        tone: 'playful',
        text: 'Panakam in hand, blessings on the way. Happy Ram Navami!',
      },
      {
        tone: 'poetic',
        text: 'Truth, patience and love, the oldest stories keep returning to them. May they walk beside you all your days.',
      },
    ],
  }),
  o({
    id: 'guru-nanak-jayanti',
    name: 'Guru Nanak Jayanti',
    category: 'india',
    emoji: '🕯️',
    months: [11],
    keywords: ['gurpurab', 'guru purab', 'sikh', 'prakash parv'],
    titles: ['Happy Gurpurab', 'Happy Guru Nanak Jayanti'],
    messages: [
      {
        tone: 'warm',
        text: 'May the teachings of Guru Nanak Dev Ji fill your life with kindness, humility and light. Wishing you and your family a blessed Gurpurab.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Guru Nanak Jayanti. May this Prakash Parv bring peace, harmony and happiness to you and your loved ones.',
      },
      {
        tone: 'playful',
        text: 'Langar, lights and a whole lot of love. Wishing you a joyful Gurpurab!',
      },
      {
        tone: 'poetic',
        text: 'Ik Onkar: one light in every heart. May you see it in others, and may they always see it in you.',
      },
    ],
  }),
  o({
    id: 'eid-ul-fitr',
    name: 'Eid ul-Fitr',
    category: 'india',
    emoji: '🌙',
    months: [3, 4],
    keywords: ['eid', 'eid mubarak', 'ramzan', 'ramadan'],
    titles: ['Eid Mubarak', 'Wishing you a blessed Eid'],
    messages: [
      {
        tone: 'warm',
        text: 'Eid Mubarak! May Allah accept your prayers and fasts, and may your home be filled with joy, sheer khurma and the warmth of family today and always.',
      },
      {
        tone: 'formal',
        text: 'Warm Eid ul-Fitr greetings to you and your family. May this blessed day bring peace, happiness and prosperity.',
      },
      {
        tone: 'playful',
        text: 'Eid Mubarak! Officially accepting Eidi in cash, biryani or sevaiyan. Have the most delicious day!',
      },
      {
        tone: 'poetic',
        text: 'A thin new moon, a month of patience, and a morning that tastes of sweetness. May your heart be as full as your table today.',
      },
    ],
  }),
  o({
    id: 'eid-al-adha',
    name: 'Eid al-Adha (Bakrid)',
    category: 'india',
    emoji: '🕌',
    months: [5, 6],
    keywords: ['bakrid', 'bakra eid', 'eid mubarak', 'qurbani'],
    titles: ['Eid al-Adha Mubarak', 'Eid Mubarak'],
    messages: [
      {
        tone: 'warm',
        text: 'Eid al-Adha Mubarak! May this blessed day remind us of faith, generosity and gratitude, and may your home be full of peace and togetherness.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Eid al-Adha to you and your family. May this occasion bring you happiness, peace and prosperity.',
      },
      {
        tone: 'playful',
        text: 'Eid Mubarak! Wishing you full plates, fuller hearts and an afternoon nap you truly deserve.',
      },
      {
        tone: 'poetic',
        text: 'To give, and to give thanks: may this Eid fill your hands with blessings and your heart with the quiet joy of sharing.',
      },
    ],
  }),
  o({
    id: 'buddha-purnima',
    name: 'Buddha Purnima',
    category: 'india',
    emoji: '🪷',
    months: [4, 5],
    keywords: ['vesak', 'buddha jayanti'],
    titles: ['Happy Buddha Purnima', 'Peace on Buddha Purnima'],
    messages: [
      {
        tone: 'warm',
        text: 'May the light of the Buddha’s teachings bring calm to your mind, kindness to your heart and peace to your home. Happy Buddha Purnima!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Buddha Purnima. May this day bring you and your family peace, wisdom and happiness.',
      },
      {
        tone: 'playful',
        text: 'Today’s plan: breathe in, breathe out, be kind, repeat. Happy Buddha Purnima!',
      },
      {
        tone: 'poetic',
        text: 'Under a full moon, a lotus opens in still water. May you find that same stillness, and may it bloom into peace.',
      },
    ],
  }),
  o({
    id: 'mahavir-jayanti',
    name: 'Mahavir Jayanti',
    category: 'india',
    emoji: '🙏',
    months: [3, 4],
    keywords: ['mahavir', 'jain'],
    titles: ['Happy Mahavir Jayanti', 'Peace and blessings'],
    messages: [
      {
        tone: 'warm',
        text: 'May Lord Mahavir’s message of non-violence, truth and compassion guide you, and may your life be filled with peace. Happy Mahavir Jayanti!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Mahavir Jayanti. May this day bring peace, harmony and happiness to you and your family.',
      },
      {
        tone: 'playful',
        text: 'Be gentle, be kind, and maybe forgive the person who took the last biscuit. Happy Mahavir Jayanti!',
      },
      {
        tone: 'poetic',
        text: 'Live and let live. Three small words, a whole way of being. May they bring you calm all year.',
      },
    ],
  }),
  o({
    id: 'navroz',
    name: 'Navroz',
    category: 'india',
    emoji: '🌷',
    months: [3, 8],
    keywords: ['nowruz', 'parsi new year', 'jamshedi navroz'],
    titles: ['Navroz Mubarak', 'Happy Parsi New Year'],
    messages: [
      {
        tone: 'warm',
        text: 'Navroz Mubarak! May the new year bring fresh beginnings, good health and a table that is always full of family and laughter.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Navroz. May the new year bring prosperity, happiness and success to you and your family.',
      },
      {
        tone: 'playful',
        text: 'New year, same sali boti cravings. Navroz Mubarak!',
      },
      {
        tone: 'poetic',
        text: 'Good thoughts, good words, good deeds. May the new year carry all three to your door.',
      },
    ],
  }),
  o({
    id: 'independence-day',
    name: 'Independence Day (India)',
    category: 'india',
    emoji: '🇮🇳',
    months: [8],
    keywords: ['15 august', 'swatantrata diwas', 'tiranga', 'freedom'],
    titles: ['Happy Independence Day', 'Jai Hind'],
    messages: [
      {
        tone: 'warm',
        text: 'Here’s to the freedom we are lucky to have and to everyone who made it possible. Happy Independence Day! Jai Hind!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Independence Day. May we keep building a nation we are proud of, together.',
      },
      {
        tone: 'playful',
        text: 'Tiranga up, kites up, spirits up! Happy Independence Day!',
      },
      {
        tone: 'poetic',
        text: 'Saffron for courage, white for truth, green for hope. May all three fly high in our hearts today and every day.',
      },
    ],
  }),
  o({
    id: 'republic-day',
    name: 'Republic Day (India)',
    category: 'india',
    emoji: '🇮🇳',
    months: [1],
    keywords: ['26 january', 'gantantra diwas', 'constitution'],
    titles: ['Happy Republic Day', 'Proud to be Indian'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy Republic Day! Let’s celebrate the freedom, the voice and the values our Constitution gives every one of us.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on Republic Day. May the spirit of unity, justice and equality continue to guide us all.',
      },
      {
        tone: 'playful',
        text: 'Parade on TV, jalebi in hand, flag on the balcony. Happy Republic Day!',
      },
      {
        tone: 'poetic',
        text: 'Many languages, one song. Many people, one promise. Happy Republic Day.',
      },
    ],
  }),

  // ---------------- Festivals around the world ----------------
  o({
    id: 'new-year',
    name: 'New Year',
    category: 'world',
    emoji: '🎆',
    months: [12, 1],
    keywords: ['new year’s eve', 'nye', 'happy new year'],
    titles: ['Happy New Year', 'Cheers to a wonderful year', 'Here’s to new beginnings'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you for being part of my year. Wishing you twelve months of good health, small joys, big wins and people who make you feel at home. Happy New Year!',
      },
      {
        tone: 'formal',
        text: 'Wishing you a happy and successful New Year. Thank you for your trust and partnership. We look forward to achieving great things together in the year ahead.',
      },
      {
        tone: 'playful',
        text: 'New year, same me, but with better playlists and slightly more water. Happy New Year! Let’s make it a great one.',
      },
      {
        tone: 'poetic',
        text: 'A clean page, a quiet morning and three hundred and sixty-five chances to begin again. May this year be kind to you, and may you be kind to yourself.',
      },
    ],
  }),
  o({
    id: 'christmas',
    name: 'Christmas',
    category: 'world',
    emoji: '🎄',
    months: [12],
    keywords: ['xmas', 'merry christmas', 'holidays', 'season’s greetings'],
    titles: ['Merry Christmas', 'Season’s Greetings', 'Warm wishes this Christmas'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you a Christmas full of warm lights, good food and the people who make your heart feel full. Merry Christmas to you and your family!',
      },
      {
        tone: 'formal',
        text: 'Season’s greetings and best wishes for a peaceful holiday season. Thank you for a wonderful year of working together.',
      },
      {
        tone: 'playful',
        text: 'I asked Santa for a great colleague. Turns out he delivered early. Merry Christmas! Don’t eat all the cookies.',
      },
      {
        tone: 'poetic',
        text: 'Snow on the window, a candle in the dark, a song that everyone somehow knows. May the quiet magic of this season find you.',
      },
    ],
  }),
  o({
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    category: 'world',
    emoji: '🏮',
    months: [1, 2],
    keywords: ['chinese new year', 'spring festival', 'tet', 'seollal'],
    titles: ['Happy Lunar New Year', 'Wishing you luck and joy'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you a Lunar New Year full of good luck, good health and good company. May every door you open lead somewhere wonderful.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes for a prosperous Lunar New Year. May the year ahead bring you health, happiness and success.',
      },
      {
        tone: 'playful',
        text: 'Red envelopes welcome, dumplings mandatory. Happy Lunar New Year!',
      },
      {
        tone: 'poetic',
        text: 'Red lanterns swaying, a new moon rising, and a whole year ready to bloom. May fortune follow you like the spring.',
      },
    ],
  }),
  o({
    id: 'ramadan',
    name: 'Ramadan',
    category: 'world',
    emoji: '🏮',
    months: [2, 3],
    keywords: ['ramzan', 'ramadan kareem', 'ramadan mubarak'],
    titles: ['Ramadan Mubarak', 'Ramadan Kareem'],
    messages: [
      {
        tone: 'warm',
        text: 'Ramadan Mubarak! May this holy month bring you peace, patience and many blessed iftars with the people you love.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes to you and your family for a blessed Ramadan. May this month bring peace, reflection and happiness.',
      },
      {
        tone: 'playful',
        text: 'Wishing you a peaceful Ramadan and the strength to wait for iftar without staring at the clock (too much).',
      },
      {
        tone: 'poetic',
        text: 'Lanterns glowing, a crescent in the sky, and hearts turned gently inward. May this month fill you with light.',
      },
    ],
  }),
  o({
    id: 'easter',
    name: 'Easter',
    category: 'world',
    emoji: '🥚',
    months: [3, 4],
    keywords: ['happy easter', 'spring'],
    titles: ['Happy Easter', 'Easter blessings'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you a joyful Easter full of hope, spring sunshine and time with the people you love.',
      },
      {
        tone: 'formal',
        text: 'Warm Easter wishes to you and your family. May this season bring renewal, peace and happiness.',
      },
      {
        tone: 'playful',
        text: 'May your basket be full and your chocolate supply never run out. Happy Easter!',
      },
      {
        tone: 'poetic',
        text: 'Flowers open, mornings brighten, and the world remembers how to begin again. A blessed Easter to you.',
      },
    ],
  }),
  o({
    id: 'hanukkah',
    name: 'Hanukkah',
    category: 'world',
    emoji: '🕎',
    months: [11, 12],
    keywords: ['chanukah', 'festival of lights'],
    titles: ['Happy Hanukkah', 'Chag Sameach'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you eight bright nights of warmth, light and togetherness. Happy Hanukkah to you and your family!',
      },
      {
        tone: 'formal',
        text: 'Warm wishes for a joyful Hanukkah. May the festival of lights bring peace and happiness to your home.',
      },
      {
        tone: 'playful',
        text: 'Eight nights, endless latkes, and a dreidel that always lands on gimel. Happy Hanukkah!',
      },
      {
        tone: 'poetic',
        text: 'One candle more each night, until the window is full of light. May your hope grow the same way.',
      },
    ],
  }),
  o({
    id: 'thanksgiving',
    name: 'Thanksgiving',
    category: 'world',
    emoji: '🍂',
    months: [10, 11],
    keywords: ['grateful', 'gratitude', 'harvest'],
    titles: ['Happy Thanksgiving', 'Grateful for you'],
    messages: [
      {
        tone: 'warm',
        text: 'This Thanksgiving I’m counting my blessings, and you are one of them. Wishing you a warm table and a full heart.',
      },
      {
        tone: 'formal',
        text: 'Happy Thanksgiving. We are grateful for your partnership and wish you a restful holiday with your loved ones.',
      },
      {
        tone: 'playful',
        text: 'Thankful for you, and for elastic waistbands. Happy Thanksgiving!',
      },
      {
        tone: 'poetic',
        text: 'Golden leaves, a long table, and the simple joy of saying thank you. May gratitude follow you all year.',
      },
    ],
  }),
  o({
    id: 'valentines-day',
    name: 'Valentine’s Day',
    category: 'world',
    emoji: '💝',
    months: [2],
    keywords: ['valentine', 'love', 'romance'],
    titles: ['Happy Valentine’s Day', 'With love', 'You make my heart smile'],
    messages: [
      {
        tone: 'warm',
        text: 'Every day with you feels a little brighter. Thank you for your love, your patience and your laugh. Happy Valentine’s Day!',
      },
      {
        tone: 'formal',
        text: 'Wishing you a lovely Valentine’s Day filled with warmth, kindness and the company of those you hold dear.',
      },
      {
        tone: 'playful',
        text: 'You’re the cheese to my pizza and the charger to my phone. Happy Valentine’s Day!',
      },
      {
        tone: 'poetic',
        text: 'If I had a flower for every time you crossed my mind, I could walk through my garden forever.',
      },
    ],
  }),
  o({
    id: 'womens-day',
    name: 'International Women’s Day',
    category: 'world',
    emoji: '💐',
    months: [3],
    keywords: ['womens day', 'iwd', '8 march'],
    titles: ['Happy Women’s Day', 'Celebrating you'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy Women’s Day! Thank you for your strength, your kindness and the way you lift everyone around you. The world is better with you in it.',
      },
      {
        tone: 'formal',
        text: 'On International Women’s Day we celebrate your achievements and your leadership. Thank you for everything you bring to our team.',
      },
      {
        tone: 'playful',
        text: 'Multitasker, problem solver, queen of the group chat. Happy Women’s Day!',
      },
      {
        tone: 'poetic',
        text: 'Quietly brave, endlessly kind, and stronger than you know. Today the world celebrates you, and so do I.',
      },
    ],
  }),
  o({
    id: 'mothers-day',
    name: 'Mother’s Day',
    category: 'world',
    emoji: '🌷',
    months: [5],
    keywords: ['mom', 'mum', 'maa', 'mother'],
    titles: ['Happy Mother’s Day', 'For the best mom'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you for every packed lunch, every late-night talk and every time you believed in me before I did. Happy Mother’s Day!',
      },
      {
        tone: 'formal',
        text: 'Wishing you a very happy Mother’s Day. May your day be filled with love and appreciation.',
      },
      {
        tone: 'playful',
        text: 'Happy Mother’s Day to the person who still knows where everything is. Thank you for everything (including finding my keys).',
      },
      {
        tone: 'poetic',
        text: 'You were my first home. Wherever I go, I carry you with me.',
      },
    ],
  }),
  o({
    id: 'fathers-day',
    name: 'Father’s Day',
    category: 'world',
    emoji: '👔',
    months: [6],
    keywords: ['dad', 'papa', 'father'],
    titles: ['Happy Father’s Day', 'For the best dad'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you for your quiet strength, your terrible jokes and the way you always showed up. Happy Father’s Day!',
      },
      {
        tone: 'formal',
        text: 'Wishing you a very happy Father’s Day. May your day be as wonderful as the care you give your family.',
      },
      {
        tone: 'playful',
        text: 'Happy Father’s Day! Today you get full control of the TV remote and the thermostat.',
      },
      {
        tone: 'poetic',
        text: 'You held my hand until I could walk, then let go so I could run. Thank you for both.',
      },
    ],
  }),
  o({
    id: 'friendship-day',
    name: 'Friendship Day',
    category: 'world',
    emoji: '🤝',
    months: [8],
    keywords: ['friend', 'bff', 'dosti'],
    titles: ['Happy Friendship Day', 'Thank you for being my friend'],
    messages: [
      {
        tone: 'warm',
        text: 'Some people make life easier just by being in it. You’re one of them. Happy Friendship Day!',
      },
      {
        tone: 'formal',
        text: 'Happy Friendship Day. It is a privilege to work alongside someone so kind and dependable.',
      },
      {
        tone: 'playful',
        text: 'You know too much about me, so we have to stay friends forever. Happy Friendship Day!',
      },
      {
        tone: 'poetic',
        text: 'A friend is someone who knows the song in your heart and sings it back when you forget the words.',
      },
    ],
  }),
  o({
    id: 'teachers-day',
    name: 'Teachers’ Day',
    category: 'world',
    emoji: '📚',
    months: [9, 10],
    keywords: ['teacher', 'guru', 'mentor', 'guru purnima'],
    titles: ['Happy Teachers’ Day', 'Thank you, guru'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you for your patience, your encouragement and for seeing what I could become. Happy Teachers’ Day!',
      },
      {
        tone: 'formal',
        text: 'Happy Teachers’ Day. Thank you for your guidance and mentorship. Your support has made a real difference.',
      },
      {
        tone: 'playful',
        text: 'Thank you for teaching me so much, and for pretending not to notice when I hadn’t done the reading. Happy Teachers’ Day!',
      },
      {
        tone: 'poetic',
        text: 'A good teacher lights a lamp and walks on. The light stays. Thank you for mine.',
      },
    ],
  }),

  // ---------------- Life moments ----------------
  o({
    id: 'birthday',
    name: 'Birthday',
    category: 'life',
    emoji: '🎂',
    months: [],
    keywords: ['bday', 'happy birthday', 'janamdin'],
    titles: ['Happy Birthday', 'Have a wonderful birthday', 'Another year of you'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy birthday! I hope today is full of the people and things you love most, and that this year brings you every bit of the happiness you bring to others.',
      },
      {
        tone: 'formal',
        text: 'Wishing you a very happy birthday and a year ahead full of good health, success and happiness.',
      },
      {
        tone: 'playful',
        text: 'Happy birthday! You’re not getting older, you’re just leveling up. Enjoy the cake. All of it.',
      },
      {
        tone: 'poetic',
        text: 'Another trip around the sun, and the world is still brighter for having you in it. May this year be your most beautiful chapter yet.',
      },
    ],
  }),
  o({
    id: 'wedding',
    name: 'Wedding',
    category: 'life',
    emoji: '💍',
    months: [],
    keywords: ['marriage', 'shaadi', 'married', 'newlyweds'],
    titles: ['Congratulations on your wedding', 'Happily ever after', 'To the happy couple'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations to you both! May your life together be full of laughter, patience, adventure and a love that grows deeper every year.',
      },
      {
        tone: 'formal',
        text: 'Heartiest congratulations on your wedding. Wishing you both a lifetime of happiness, understanding and togetherness.',
      },
      {
        tone: 'playful',
        text: 'Congratulations! Officially a team now: one of you finds the remote, the other hides the snacks. Wishing you a lifetime of happiness!',
      },
      {
        tone: 'poetic',
        text: 'Two paths have become one road. May it be long, may it be gentle, and may you always walk it hand in hand.',
      },
    ],
  }),
  o({
    id: 'engagement',
    name: 'Engagement',
    category: 'life',
    emoji: '💞',
    months: [],
    keywords: ['engaged', 'roka', 'sagai'],
    titles: ['Congratulations on your engagement', 'She said yes!', 'He said yes!'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations on your engagement! I’m so happy for you both. Here’s to love, laughter and all the planning ahead.',
      },
      {
        tone: 'formal',
        text: 'Warmest congratulations on your engagement. Wishing you both great joy as you begin this new chapter together.',
      },
      {
        tone: 'playful',
        text: 'Congratulations! Let the wedding group chat chaos begin. So happy for you two!',
      },
      {
        tone: 'poetic',
        text: 'A promise made, a ring that holds it, and a future waiting to be written together. Congratulations.',
      },
    ],
  }),
  o({
    id: 'anniversary',
    name: 'Anniversary',
    category: 'life',
    emoji: '❤️',
    months: [],
    keywords: ['wedding anniversary', 'years together'],
    titles: ['Happy Anniversary', 'Cheers to many more years'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy anniversary! Watching your love grow is a reminder of what really matters. Wishing you many more years of happiness together.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on your anniversary. May the years ahead bring you both continued love and happiness.',
      },
      {
        tone: 'playful',
        text: 'Happy anniversary! Still putting up with each other, and still adorable. Here’s to many more!',
      },
      {
        tone: 'poetic',
        text: 'Love isn’t one big moment, it’s a thousand small ones, chosen again and again. Happy anniversary to you both.',
      },
    ],
  }),
  o({
    id: 'new-baby',
    name: 'New baby',
    category: 'life',
    emoji: '👶',
    months: [],
    keywords: ['baby', 'newborn', 'parents', 'birth'],
    titles: ['Welcome, little one', 'Congratulations on your baby'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations on your beautiful new baby! Wishing your growing family health, happiness and lots of sleep (eventually).',
      },
      {
        tone: 'formal',
        text: 'Warmest congratulations on the arrival of your little one. Wishing your family great joy and good health.',
      },
      {
        tone: 'playful',
        text: 'Welcome to the world of tiny socks and big love! Congratulations, and good luck with the night shifts.',
      },
      {
        tone: 'poetic',
        text: 'Ten tiny fingers, ten tiny toes, and a love bigger than anything you have known. Welcome to the world, little one.',
      },
    ],
  }),
  o({
    id: 'graduation',
    name: 'Graduation',
    category: 'life',
    emoji: '🎓',
    months: [],
    keywords: ['degree', 'convocation', 'exam results', 'passed'],
    titles: ['Congratulations, graduate!', 'You did it!'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations! All those late nights and hard work paid off. I’m so proud of you and excited for everything that comes next.',
      },
      {
        tone: 'formal',
        text: 'Heartiest congratulations on your graduation. Wishing you every success in the next chapter of your journey.',
      },
      {
        tone: 'playful',
        text: 'You did it! Time to throw that cap and finally sleep for a week. Congratulations!',
      },
      {
        tone: 'poetic',
        text: 'One door closes behind you and a hundred open ahead. Walk through the ones that make your heart beat faster.',
      },
    ],
  }),
  o({
    id: 'housewarming',
    name: 'New home',
    category: 'life',
    emoji: '🏡',
    months: [],
    keywords: ['housewarming', 'griha pravesh', 'new house', 'moving'],
    titles: ['Congratulations on your new home', 'Happy housewarming'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations on your new home! May it be filled with laughter, good food and friends who come by often.',
      },
      {
        tone: 'formal',
        text: 'Warm wishes on your new home. May it bring you comfort, happiness and many wonderful memories.',
      },
      {
        tone: 'playful',
        text: 'New home, new Wi-Fi password. Congratulations! When is the party?',
      },
      {
        tone: 'poetic',
        text: 'Four walls become a home the day love moves in. May yours always be warm.',
      },
    ],
  }),
  o({
    id: 'good-luck',
    name: 'Good luck',
    category: 'life',
    emoji: '🍀',
    months: [],
    keywords: ['all the best', 'exam', 'interview', 'best wishes'],
    titles: ['Good luck!', 'All the best', 'You’ve got this'],
    messages: [
      {
        tone: 'warm',
        text: 'Wishing you all the luck in the world. You’ve prepared for this, and I believe in you completely. Go show them what you can do!',
      },
      {
        tone: 'formal',
        text: 'Best wishes for the day ahead. I have every confidence that you will do brilliantly.',
      },
      {
        tone: 'playful',
        text: 'Sending you a four-leaf clover, a lucky charm and a very loud cheer. You’ve got this!',
      },
      {
        tone: 'poetic',
        text: 'Take a deep breath. Everything you need, you already carry with you.',
      },
    ],
  }),

  // ---------------- At work ----------------
  o({
    id: 'work-anniversary',
    name: 'Work anniversary',
    category: 'work',
    emoji: '🏅',
    months: [],
    keywords: ['years at work', 'milestone', 'service'],
    titles: ['Happy work anniversary', 'Cheers to your milestone'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy work anniversary! Thank you for all the energy, ideas and kindness you bring every single day. We’re lucky to have you.',
      },
      {
        tone: 'formal',
        text: 'Congratulations on your work anniversary. Your dedication and contributions are truly valued. Here’s to many more successful years together.',
      },
      {
        tone: 'playful',
        text: 'Another year of meetings that could have been emails, and you still make them fun. Happy work anniversary!',
      },
      {
        tone: 'poetic',
        text: 'Year by year, the work grows and so do we. Thank you for being part of the story.',
      },
    ],
  }),
  o({
    id: 'promotion',
    name: 'Promotion',
    category: 'work',
    emoji: '🚀',
    months: [],
    keywords: ['new role', 'promoted', 'career'],
    titles: ['Congratulations on your promotion', 'Well deserved!'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations on your promotion! Nobody deserves it more. Your hard work and heart show in everything you do.',
      },
      {
        tone: 'formal',
        text: 'Heartiest congratulations on your well-deserved promotion. Wishing you great success in your new role.',
      },
      {
        tone: 'playful',
        text: 'Congratulations, boss! Does this mean you’re buying the samosas now?',
      },
      {
        tone: 'poetic',
        text: 'The climb was yours, every step of it. Enjoy the view, and keep going.',
      },
    ],
  }),
  o({
    id: 'welcome',
    name: 'Welcome aboard',
    category: 'work',
    emoji: '👋',
    months: [],
    keywords: ['new joiner', 'onboarding', 'new colleague', 'new job'],
    titles: ['Welcome aboard!', 'Welcome to the team'],
    messages: [
      {
        tone: 'warm',
        text: 'Welcome to the team! We’re so happy you’re here. Ask anything, anytime, and we’ll help you feel at home.',
      },
      {
        tone: 'formal',
        text: 'A warm welcome to the team. We look forward to working with you and wish you every success in your new role.',
      },
      {
        tone: 'playful',
        text: 'Welcome aboard! The coffee is strong, the team is great and the Wi-Fi password is on the fridge.',
      },
      {
        tone: 'poetic',
        text: 'Every team is a story, and today a new chapter begins. We’re glad it has you in it.',
      },
    ],
  }),
  o({
    id: 'farewell',
    name: 'Farewell',
    category: 'work',
    emoji: '✈️',
    months: [],
    keywords: ['goodbye', 'last day', 'leaving', 'moving on'],
    titles: ['We’ll miss you', 'Farewell and good luck'],
    messages: [
      {
        tone: 'warm',
        text: 'It won’t be the same without you. Thank you for the laughs, the help and the friendship. Wherever you go next, they’re lucky to have you.',
      },
      {
        tone: 'formal',
        text: 'Thank you for your contributions and dedication. We wish you every success in your next chapter. Please stay in touch.',
      },
      {
        tone: 'playful',
        text: 'Who’s going to fix the printer now? We’ll miss you! Good luck, and don’t be a stranger.',
      },
      {
        tone: 'poetic',
        text: 'Some people leave a desk empty and a team a little fuller for having known them. Go well, and know you always have a place here.',
      },
    ],
  }),
  o({
    id: 'congratulations',
    name: 'Congratulations',
    category: 'work',
    emoji: '🎉',
    months: [],
    keywords: ['congrats', 'achievement', 'badhai', 'mubarak'],
    titles: ['Congratulations!', 'Bravo!', 'So proud of you'],
    messages: [
      {
        tone: 'warm',
        text: 'Congratulations! This is such wonderful news, and you deserve every bit of it. I’m so happy for you.',
      },
      {
        tone: 'formal',
        text: 'Heartiest congratulations on this achievement. Your hard work and commitment have truly paid off.',
      },
      {
        tone: 'playful',
        text: 'Cue the confetti! Congratulations, superstar. Celebration snacks are on you.',
      },
      {
        tone: 'poetic',
        text: 'Every quiet effort, every early morning, every doubt you pushed past, it all led here. Congratulations.',
      },
    ],
  }),
  o({
    id: 'thank-you',
    name: 'Thank you',
    category: 'work',
    emoji: '🙏',
    months: [],
    keywords: ['thanks', 'grateful', 'appreciation', 'dhanyavaad', 'shukriya'],
    titles: ['Thank you', 'With gratitude', 'You’re the best'],
    messages: [
      {
        tone: 'warm',
        text: 'Thank you so much. Your help meant more than you know, and it made a real difference. I’m grateful to have you around.',
      },
      {
        tone: 'formal',
        text: 'Thank you for your support and effort. It is truly appreciated and made a real difference to the outcome.',
      },
      {
        tone: 'playful',
        text: 'Thank you! You saved the day, and possibly my sanity. I owe you a coffee (or three).',
      },
      {
        tone: 'poetic',
        text: 'Some kindness is loud, some is quiet. Yours was the kind that stays. Thank you.',
      },
    ],
  }),
  o({
    id: 'great-work',
    name: 'Great work',
    category: 'work',
    emoji: '🌟',
    months: [],
    keywords: ['kudos', 'well done', 'shout out', 'appreciation'],
    titles: ['Great work!', 'Kudos to you', 'You nailed it'],
    messages: [
      {
        tone: 'warm',
        text: 'Amazing job! The care and effort you put in really showed. Thank you for going the extra mile.',
      },
      {
        tone: 'formal',
        text: 'Excellent work. Your attention to detail and commitment to quality are an example for the whole team.',
      },
      {
        tone: 'playful',
        text: 'Absolute legend. That was chef’s-kiss level work. Take a bow!',
      },
      {
        tone: 'poetic',
        text: 'Good work speaks quietly but carries far. Yours did. Thank you.',
      },
    ],
  }),
  o({
    id: 'retirement',
    name: 'Retirement',
    category: 'work',
    emoji: '🌅',
    months: [],
    keywords: ['retired', 'farewell', 'new chapter'],
    titles: ['Happy retirement', 'Enjoy the next chapter'],
    messages: [
      {
        tone: 'warm',
        text: 'Happy retirement! Thank you for everything you taught us. Now it’s time for slow mornings, long walks and everything you’ve been putting off.',
      },
      {
        tone: 'formal',
        text: 'Congratulations on your retirement. Thank you for your years of dedication and leadership. Wishing you health and happiness ahead.',
      },
      {
        tone: 'playful',
        text: 'No more alarms, no more meetings, no more “quick calls”. Happy retirement! We’re officially jealous.',
      },
      {
        tone: 'poetic',
        text: 'A long and wonderful working life comes to rest, and a new season begins. May it be the sweetest one yet.',
      },
    ],
  }),
  o({
    id: 'launch',
    name: 'Project launch',
    category: 'work',
    emoji: '🚀',
    months: [],
    keywords: ['go live', 'release', 'launch', 'milestone', 'project'],
    titles: ['Congratulations on the launch!', 'We’re live!'],
    messages: [
      {
        tone: 'warm',
        text: 'We did it! Thank you to everyone who poured their time and heart into this launch. Proud to be on this team.',
      },
      {
        tone: 'formal',
        text: 'Congratulations on a successful launch. This is a great milestone, made possible by excellent teamwork and dedication.',
      },
      {
        tone: 'playful',
        text: 'Houston, we have a launch! Congratulations, team. Pizza is on its way.',
      },
      {
        tone: 'poetic',
        text: 'Months of ideas, drafts and late nights, and now it flies. Congratulations on bringing it to life.',
      },
    ],
  }),

  // ---------------- Care and support ----------------
  o({
    id: 'get-well',
    name: 'Get well soon',
    category: 'care',
    emoji: '💐',
    months: [],
    keywords: ['recovery', 'feel better', 'sick', 'health'],
    titles: ['Get well soon', 'Thinking of you', 'Feel better soon'],
    messages: [
      {
        tone: 'warm',
        text: 'Sending you lots of love and healing thoughts. Rest well, take it slow, and don’t worry about anything here. We’ve got it covered.',
      },
      {
        tone: 'formal',
        text: 'Wishing you a speedy and complete recovery. Please take all the time you need, and know that we are thinking of you.',
      },
      {
        tone: 'playful',
        text: 'Get well soon! The team is a lot less fun without you, and nobody else laughs at my jokes.',
      },
      {
        tone: 'poetic',
        text: 'Every day a little stronger, every morning a little brighter. Healing wishes are coming your way.',
      },
    ],
  }),
  o({
    id: 'condolence',
    name: 'Condolences',
    category: 'care',
    emoji: '🕊️',
    months: [],
    quiet: true,
    keywords: ['sympathy', 'loss', 'grief', 'shraddhanjali', 'rip'],
    titles: ['With deepest sympathy', 'Thinking of you', 'In loving memory'],
    messages: [
      {
        tone: 'warm',
        text: 'I’m so sorry for your loss. There are no words that make this easier, but please know I’m thinking of you and I’m here for anything you need.',
      },
      {
        tone: 'formal',
        text: 'Please accept our heartfelt condolences. Our thoughts are with you and your family during this difficult time. Take all the time you need.',
      },
      {
        tone: 'poetic',
        text: 'Those we love never truly leave us. They live on in every memory, every lesson and every kindness they gave. Holding you close in my thoughts.',
      },
    ],
  }),
  o({
    id: 'thinking-of-you',
    name: 'Thinking of you',
    category: 'care',
    emoji: '🤗',
    months: [],
    keywords: ['support', 'hug', 'care', 'miss you', 'here for you'],
    titles: ['Thinking of you', 'Sending you a hug', 'I’m here for you'],
    messages: [
      {
        tone: 'warm',
        text: 'Just wanted you to know I’m thinking of you. Whatever you’re going through, you don’t have to go through it alone.',
      },
      {
        tone: 'formal',
        text: 'Thinking of you and sending my best wishes. Please don’t hesitate to reach out if there is anything I can do.',
      },
      {
        tone: 'playful',
        text: 'This is a hug in message form. Please accept delivery. Thinking of you!',
      },
      {
        tone: 'poetic',
        text: 'Even on the cloudiest days the sun is still there, waiting. So am I.',
      },
    ],
  }),
] as const satisfies readonly GreetingOccasion[];

export type GreetingOccasionId = (typeof GREETING_OCCASIONS)[number]['id'];
const OCCASION_IDS = GREETING_OCCASIONS.map((x) => x.id) as [
  GreetingOccasionId,
  ...GreetingOccasionId[],
];
export const GreetingOccasionIdSchema = z.enum(OCCASION_IDS);

export const MAX_GREETING_TITLE = 80;
export const MAX_GREETING_TO = 60;

/** `metadata.greeting` on a greeting card message, and `greeting` on a send request. */
export const GreetingCardSchema = z.object({
  occasionId: GreetingOccasionIdSchema,
  styleId: GreetingStyleIdSchema,
  /** The headline on the card, e.g. "Happy Diwali". Editable before sending. */
  title: z.string().trim().min(1).max(MAX_GREETING_TITLE),
  /** Who it is for, shown as "Dear …". */
  to: z.string().trim().max(MAX_GREETING_TO).nullable().default(null),
});
export type GreetingCard = z.infer<typeof GreetingCardSchema>;

/** The greeting card a message carries, or null. */
export function greetingOf(m: { metadata?: Record<string, unknown> }): GreetingCard | null {
  const r = GreetingCardSchema.safeParse(m.metadata?.greeting);
  return r.success ? r.data : null;
}

export function greetingOccasion(id: string): GreetingOccasion | null {
  return (GREETING_OCCASIONS as readonly GreetingOccasion[]).find((x) => x.id === id) ?? null;
}

/** Organization rules: Administration → Greeting cards. Missing means on, everything offered. */
export const GreetingPolicySchema = z.object({
  enabled: z.boolean().default(true),
  /** Categories hidden from the picker (for example, to keep festivals out of a client space). */
  hiddenCategories: z.array(GreetingCategorySchema).max(GREETING_CATEGORIES.length).default([]),
});
export type GreetingPolicy = z.infer<typeof GreetingPolicySchema>;
export const DEFAULT_GREETING_POLICY: GreetingPolicy = { enabled: true, hiddenCategories: [] };

export function greetingAllowed(policy: GreetingPolicy, occasionId: string): boolean {
  if (!policy.enabled) return false;
  const occ = greetingOccasion(occasionId);
  return !!occ && !policy.hiddenCategories.includes(occ.category);
}

/** The occasions on offer under a policy, in catalogue order. */
export function offeredOccasions(policy: GreetingPolicy): GreetingOccasion[] {
  if (!policy.enabled) return [];
  return (GREETING_OCCASIONS as readonly GreetingOccasion[]).filter(
    (x) => !policy.hiddenCategories.includes(x.category),
  );
}

/**
 * Festivals that usually fall this month or next, soonest first, for "Coming up".
 * Lunar festivals move each year, so this is a hint, not a calendar.
 */
export function upcomingOccasions(
  occasions: readonly GreetingOccasion[],
  now: Date = new Date(),
): GreetingOccasion[] {
  const m = now.getMonth() + 1;
  const next = (m % 12) + 1;
  const rank = (x: GreetingOccasion) =>
    x.months.includes(m) ? 0 : x.months.includes(next) ? 1 : 2;
  return occasions.filter((x) => x.months.length && rank(x) < 2).sort((a, b) => rank(a) - rank(b));
}

/** Case- and accent-insensitive search over names and keywords. */
export function searchOccasions(
  occasions: readonly GreetingOccasion[],
  query: string,
): GreetingOccasion[] {
  const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...occasions];
  return occasions.filter((x) =>
    [x.name, ...(x.keywords ?? []), ...x.titles].some((s) => fold(s).includes(q)),
  );
}

/** Text for previews and notifications: "🪔 Happy Diwali: <message>". */
export function greetingPreview(card: GreetingCard, text: string): string {
  const occ = greetingOccasion(card.occasionId);
  return `${occ?.emoji ?? '🎉'} ${card.title}${text ? `: ${text}` : ''}`;
}

export const GreetingPolicyStateSchema = z.object({ policy: GreetingPolicySchema });
export type GreetingPolicyState = z.infer<typeof GreetingPolicyStateSchema>;
