/* eBid Baju — mock seed data (static demo).
 * Times are relative (minutes from first load) so the demo is always "live".
 * startMin < 0 = already started. endMin < 0 = already ended.
 */
window.EB_DATA = {
  version: 9,

  platform: {
    name: 'eBid Baju',
    tagline: 'Platform lelongan pakaian white-label untuk butik anda',
    feeDefault: 10,
  },

  tenants: [
    {
      // Real first client (data from their poster). Default shop of the demo.
      slug: 'paskb',
      name: 'PAS Kawasan Kota Bharu',
      tagline: 'Majlis Makan Malam Kutipan Dana PRU Ke-16: Bidaan Istimewa',
      logoText: 'PAS',
      domain: 'bidaan.paskotabharu.my',
      plan: 'Pro',
      joinedAt: '2026-11-12',
      event: 'Majlis Makan Malam Kutipan Dana PRU Ke-16 PAS Kawasan Kota Bharu',
      beneficiary: 'Hasil bidaan akan disalurkan kepada dana pilihan raya PAS Kawasan Kota Bharu.',
      slogan: 'Bersama Menyumbang, Bersama Memperjuangkan Islam',
      colors: { brand: '#0b6b3a', brand2: '#053d22', accent: '#e0b43c', ink: '#ffffff' },
      settings: {
        fee: 10, lastWindowMin: 30, lastWindowMultiplier: 2, lastWindowOn: true,
        winLimit: 1, payDeadlineHours: 48,
        demoBots: true, // simulated bidders keep the demo lively; turn off for a real event
        // How the winner receives the item. Pickup at the event is the default for PAS KB.
        fulfilment: {
          pickup: true,
          pickupLabel: 'Ambil semasa majlis',
          pickupNote: 'Diserahkan oleh urus setia selepas pemenang diumumkan di Majlis Makan Malam. Sila bawa kad pengenalan dan resit bayaran.',
          post: true,
          default: 'pickup',
        },
      },
      tiers: [
        { id: 'istimewa', name: 'Istimewa', minPrice: 10000, increment: 500 },
        { id: 'kenangan', name: 'Kenangan', minPrice: 1000, increment: 100 },
        { id: 'sumbangan', name: 'Sumbangan', minPrice: 100, increment: 10 },
      ],
    },
  ],

  users: [
    // Demo bidders (pick one on login.html)
    { id: 'u_aina', name: 'Aina Sofea', email: 'aina@demo.my', phone: '012-345 6789', role: 'bidder' },
    { id: 'u_hafiz', name: 'Hafiz Rahman', email: 'hafiz@demo.my', phone: '013-222 1188', role: 'bidder' },
    { id: 'u_meiling', name: 'Tan Mei Ling', email: 'meiling@demo.my', phone: '016-778 9001', role: 'bidder' },
    // Bot bidders (simulate other people)
    { id: 'b_farah', name: 'Farah_88', role: 'bot' },
    { id: 'b_kicks', name: 'kicks.my', role: 'bot' },
    { id: 'b_zul', name: 'zulrahim', role: 'bot' },
    { id: 'b_nurul', name: 'nurul.h', role: 'bot' },
    { id: 'b_jason', name: 'jason_kl', role: 'bot' },
    { id: 'b_siti', name: 'siti.b', role: 'bot' },
    // Shop admin (event committee)
    { id: 'a_pas', name: 'Urus Setia PAS Kawasan Kota Bharu', role: 'admin', tenant: 'paskb' },
    // Platform super admin
    { id: 's_admin', name: 'Super Admin', role: 'super' },
  ],

  categories: ['Baju Kurung', 'Jubah', 'Tudung', 'Kebaya', 'Telekung', 'Blouse', 'Selendang',
    'Hoodie', 'Jaket', 'Rompi', 'T-Shirt', 'Seluar', 'Topi', 'Kemeja', 'Sarung', 'Kaftan', 'Kanak-kanak'],
  sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size', 'Tidak dinyatakan', '28', '30', '32', '34', '4Y', '6Y', '8Y'],
  conditions: ['Baru', 'Seperti Baru', 'Terpakai'],

  /* seed: { n: number of seeded bids, by: { '<index from end, -1 = last>': userId } } */
  items: [
    // ---- PAS Kawasan Kota Bharu (from the client's poster) ----
    { id: 'pas1', tenant: 'paskb', title: "Baju Almarhum Tuan Guru Dato' Bentara Setia Haji Nik Abdul Aziz Nik Mat", category: 'Rompi', size: 'Tidak dinyatakan', condition: 'Terpakai', tier: 'istimewa', color: '#3f6b3a',
      startPrice: 10000,
      images: ['assets/img/nikaziz-vest-hanger.jpg', 'assets/img/nikaziz-vest.jpg', 'assets/img/nikaziz-photo.jpg', 'assets/img/pas-poster.jpg'],
      // Optional video: { kind: 'youtube'|'url'|'upload', src, title }. Upload = file kept in IndexedDB (see assets/media.js).
      video: null,
      desc: "Rompi corak celoreng yang pernah dipakai oleh Almarhum Tuan Guru Dato' Bentara Setia Haji Nik Abdul Aziz Nik Mat. Hasil bidaan akan disalurkan kepada dana pilihan raya PAS Kawasan Kota Bharu.",
      // Story section shown on the shop and item pages; editable in admin/items.html
      story: {
        headline: 'Sehelai baju, sejuta kenangan',
        subheadline: 'Bidaan eksklusif baju Almarhum Tuan Guru Nik Abdul Aziz Nik Mat',
        body: [
          "Satu peluang istimewa untuk memiliki sehelai baju yang pernah dipakai oleh Almarhum Tuan Guru Dato' Bentara Setia Haji Nik Abdul Aziz Nik Mat, tokoh ulama dan negarawan yang amat disanjungi.",
          'Bukan sekadar sehelai pakaian, tetapi satu kenangan berharga daripada seorang tokoh yang meninggalkan teladan perjuangan, ilmu dan kesederhanaan.',
          'Bidaan akan berlangsung sempena Majlis Makan Malam Kutipan Dana PRU Ke-16 PAS Kawasan Kota Bharu. Hasil bidaan akan disalurkan kepada dana pilihan raya PAS Kawasan Kota Bharu.',
        ],
        closing: 'Miliki kenangannya, sumbang kepada perjuangan.',
        tagline: 'Warisan dikenang, perjuangan diteruskan.',
      },
      startMin: -1440, endMin: 2 * 1440 + 380, seed: { n: 4 } },
  ],
};
